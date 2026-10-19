import { useEffect, useMemo, useRef, useState } from 'react';
import { newSessionId } from '../lib/colorCalibration/code.js';
import { renderCalibrationCharts } from '../lib/colorCalibration/chart.js';
import { analyzePair, analyzeCorrected, parseCube, parseInformePrevisto, parseInformeReal } from '../lib/colorCalibration/analyze.js';
import { construirPerfil } from '../lib/colorCalibration/iccExport.js';
import { construirCartasArchivos } from '../lib/colorCalibration/chartFiles.js';
import PrintModal from './PrintModal.jsx';

// Asistente de calibración de color por impresora. Corrige una impresora "pálida" para
// que imprima como una de referencia. La identidad de la impresora es su IP (el nombre de
// cola cambia entre PC), salvo en las colas asignadas A MANO: ahí manda el nombre de la
// cola, porque hay impresoras (las Epson, por "EpsonNet Print Port") que se encuentran
// por MAC y cuyo puerto de Windows se queda con una IP vieja.
// Todo dentro de PrintLayout. Ver electron/color/* + src/lib/colorCalibration/*.

const api = () => (typeof window !== 'undefined' ? window.printlayout?.color : null);
const fmtDate = (s) => { try { return new Date(s).toLocaleDateString(); } catch { return ''; } };

export default function ColorCalModal({ open, onClose }) {
  const [printers, setPrinters] = useState([]);
  const [cals, setCals] = useState([]);
  const [manualIp, setManualIp] = useState({});
  const [manualPrinter, setManualPrinter] = useState({}); // cola → {ip, queue, port, assignedAt}
  const [canShare, setCanShare] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState(null); // {kind,text}
  const [perfil, setPerfil] = useState(null); // {id, path, dir, hash, bytes, fileName, iccBytes}
  const [cartas, setCartas] = useState(null); // {dir, sessionId}
  // Medir resultado: escaneos de la carta de referencia y de la corregida.
  const [medRef, setMedRef] = useState(null);
  const [medCor, setMedCor] = useState(null);
  const [medResultado, setMedResultado] = useState(null); // {informe, stats}
  const [medCal, setMedCal] = useState('');

  const [view, setView] = useState('list'); // 'list' | 'wizard'
  // Wizard
  const [step, setStep] = useState(1);
  const [correctDev, setCorrectDev] = useState('');
  const [refDev, setRefDev] = useState('');
  const [paperName, setPaperName] = useState('');
  const [sessionId, setSessionId] = useState(0);
  const [printedRef, setPrintedRef] = useState(false);
  const [printedCor, setPrintedCor] = useState(false);
  // Cuál carta se está por imprimir con el modal de impresión de siempre.
  const [printChart, setPrintChart] = useState(null); // 'ref' | 'correct' | null
  // Configuración real (papel/calidad/color) con la que se imprimen las cartas.
  const [cfgRef, setCfgRef] = useState(null);
  const [cfgCorrect, setCfgCorrect] = useState(null);
  const [scanA, setScanA] = useState(null);
  const [scanB, setScanB] = useState(null);
  const [analysis, setAnalysis] = useState(null); // {lut, informe, stats, ...}
  const fileRef = useRef(null);
  // Importar .cube
  const [cubeText, setCubeText] = useState(null);
  const [cubeInfo, setCubeInfo] = useState(null); // {name, date}
  const [informeText, setInformeText] = useState(null);
  const [informeCorrText, setInformeCorrText] = useState(null);

  const reload = async () => {
    const a = api();
    if (!a) return;
    const [pr, ls, cs] = await Promise.all([
      a.listPrinters().catch(() => ({ printers: [] })),
      a.list().catch(() => ({ calibrations: [] })),
      a.canShare().catch(() => ({ canShare: false })),
    ]);
    setPrinters(pr.printers || []);
    setCals(ls.calibrations || []);
    setManualIp(ls.manualIp || {});
    setManualPrinter(ls.manualPrinter || {});
    setCanShare(!!cs.canShare);
    setLoaded(true);
  };

  useEffect(() => { if (open) { setLoaded(false); setFeedback(null); setView('list'); reload(); } }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    // Con el modal de impresión abierto, Escape es suyo: si no, cerraría los dos.
    const onKey = (e) => { if (e.key === 'Escape' && !printChart) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, printChart]);

  // Al llegar al paso de imprimir, leemos del driver qué papel/calidad/gestión
  // de color tienen las dos impresoras: hace falta para avisar si el driver va a
  // "mejorar" el color (y arruinar la medición) y para dejar anotado con qué
  // configuración se hizo la calibración.
  useEffect(() => {
    if (view !== 'wizard' || step !== 3) return undefined;
    let cancelled = false;
    const leer = async (dev, set) => {
      if (!dev) { set(null); return; }
      try {
        const r = await window.printlayout?.pdf?.printerConfigInfo?.(dev);
        if (!cancelled) set(r?.ok ? ((r.tieneApp && r.app) ? r.app : r.windows) : null);
      } catch { if (!cancelled) set(null); }
    };
    leer(refDev, setCfgRef);
    leer(correctDev, setCfgCorrect);
    return () => { cancelled = true; };
  }, [view, step, refDev, correctDev]);

  // La asignación a mano gana sobre la IP del puerto: el puerto puede tener una
  // IP vieja (EpsonNet encuentra la máquina por MAC y nadie se entera).
  const ipOf = useMemo(() => (name) => {
    const rec = manualPrinter[name];
    if (rec && rec.ip) return rec.ip;
    const p = printers.find((x) => x.name === name);
    return (p && p.ip) || null;
  }, [printers, manualPrinter]);

  const nameForIp = useMemo(() => (ip) => {
    const asignada = Object.keys(manualPrinter).find((q) => manualPrinter[q].ip === ip);
    if (asignada) return asignada;
    const p = printers.find((x) => x.ip === ip);
    return p ? p.name : ip;
  }, [printers, manualPrinter]);

  if (!open) return null;

  const notify = (kind, text) => setFeedback({ kind, text });

  // ── Acciones de la lista ────────────────────────────────────────────────────
  const toggleActive = async (cal) => {
    setBusy('active');
    const r = await api().setActive(cal.id, !cal.active);
    if (!r.ok) notify('error', r.error || 'No se pudo cambiar el estado.');
    await reload();
    setBusy('');
  };
  const del = async (cal) => {
    if (!window.confirm('¿Borrar esta calibración de esta PC?')) return;
    setBusy('del');
    await api().delete(cal.id);
    await reload();
    setBusy('');
  };
  const share = async (cal) => {
    setBusy('share');
    const r = await api().share(cal.id);
    notify(r.ok ? 'ok' : 'error', r.ok ? 'Calibración compartida con las demás PC.' : (r.error || 'No se pudo compartir.'));
    await reload();
    setBusy('');
  };
  const deleteShared = async (cal) => {
    if (!window.confirm('¿Borrar esta calibración de TODAS las PC?')) return;
    setBusy('share');
    const r = await api().deleteShared(cal.id);
    notify(r.ok ? 'ok' : 'error', r.ok ? 'Borrada de todas las PC.' : (r.error || 'No se pudo borrar.'));
    await reload();
    setBusy('');
  };
  // Genera el .icc de una calibración y lo deja en la carpeta de perfiles.
  // `silencioso` = lo usa el pull automático (no muestra nada ni abre nada).
  const generarPerfil = async (cal, { silencioso = false } = {}) => {
    try {
      const { bytes, fileName, txtName, txt } = construirPerfil(cal);
      const r = await api().writeIcc({
        id: cal.id, fileName, bytes, txtName, txt,
      });
      if (!r?.ok) {
        if (!silencioso) notify('error', r?.error || 'No se pudo guardar el perfil.');
        return null;
      }
      if (!silencioso) {
        setPerfil({ ...r, id: cal.id, fileName, iccBytes: bytes });
        notify('ok', `Perfil guardado: ${fileName}`);
      }
      return r;
    } catch (err) {
      if (!silencioso) notify('error', `No se pudo armar el perfil: ${err.message}`);
      return null;
    }
  };

  const exportarPerfil = async (cal) => {
    setBusy('icc');
    await generarPerfil(cal);
    setBusy('');
  };

  // Guarda las dos cartas (PNG + PDF a tamaño real) para imprimirlas desde
  // afuera, por ejemplo desde Corel con el perfil puesto.
  const guardarCartas = async () => {
    setBusy('cartas');
    try {
      const sid = newSessionId();
      const files = await construirCartasArchivos(sid);
      const r = await api().writeCartas(sid, files);
      if (!r?.ok) notify('error', r?.error || 'No se pudieron guardar las cartas.');
      else {
        setCartas({ dir: r.dir, sessionId: sid });
        notify('ok', `Cartas guardadas (sesión ${sid}).`);
      }
    } catch (err) {
      notify('error', `No se pudieron armar las cartas: ${err.message}`);
    }
    setBusy('');
  };

  // ── Medir resultado ────────────────────────────────────────────────────────
  const startMedir = () => {
    setMedRef(null); setMedCor(null); setMedResultado(null); setMedCal('');
    setFeedback(null); setView('medir');
  };

  const runMedir = async () => {
    if (!medRef || !medCor) { notify('error', 'Faltan los dos escaneos.'); return; }
    setBusy('medir');
    setMedResultado(null);
    try {
      const r = await analyzeCorrected(medRef, medCor);
      setMedResultado(r);
      notify('ok', 'Medición lista.');
    } catch (err) {
      notify('error', err.message || 'No se pudo medir.');
    }
    setBusy('');
  };

  // Deja el número REAL guardado en la calibración, para que quede a la vista
  // en la lista junto al previsto.
  const guardarMedicion = async () => {
    if (!medResultado || !medCal) return;
    setBusy('medir');
    const cal = cals.find((c) => c.id === medCal);
    if (cal) {
      const r = await api().save({
        ...cal,
        results: { ...(cal.results || {}), realProm: medResultado.stats?.despuesProm ?? null },
      });
      notify(r?.ok ? 'ok' : 'error', r?.ok ? 'Resultado guardado en la calibración.' : (r?.error || 'No se pudo guardar.'));
      await reload();
    }
    setBusy('');
  };

  const guardarPerfilComo = async () => {
    if (!perfil?.iccBytes) return;
    const r = await api().saveIccAs(perfil.fileName, perfil.iccBytes);
    if (r?.error) notify('error', r.error);
    else if (!r?.canceled) notify('ok', `Guardado en ${r.path}`);
  };

  const pull = async () => {
    setBusy('pull');
    const r = await api().syncPull();
    notify(r.ok ? 'ok' : 'error', r.ok ? `Actualizado (${r.added} nuevas, ${r.updated} actualizadas, ${r.removed} borradas).` : (r.error || 'No se pudo actualizar.'));
    // Las que entraron o cambiaron por el sync se quedan SIN perfil en esta PC.
    // Se los generamos acá mismo, así en cada máquina el .icc aparece solo.
    if (r?.ok && Array.isArray(r.idsTocados) && r.idsTocados.length) {
      const lista = (await api().list())?.calibrations || [];
      for (const id of r.idsTocados) {
        const cal = lista.find((c) => c.id === id);
        // eslint-disable-next-line no-await-in-loop
        if (cal) await generarPerfil(cal, { silencioso: true });
      }
    }
    await reload();
    setBusy('');
  };
  // Asigna una COLA a una impresora de calibración. Guarda además el nombre de
  // la cola y el del puerto, que no cambian aunque la impresora tome otra IP.
  const setManual = async (queue, ip) => {
    const limpia = String(ip || '').trim();
    const p = printers.find((x) => x.name === queue);
    const r = await api().setManualPrinter(queue, limpia
      ? { ip: limpia, queueName: queue, port: (p && p.port) || '' }
      : null);
    if (r?.ok) notify('ok', limpia ? `Asignada: ${queue} → ${limpia}` : `Asignación quitada de ${queue}.`);
    else notify('error', r?.error || 'No se pudo guardar la asignación.');
    await reload();
  };

  // ── Wizard ──────────────────────────────────────────────────────────────────
  const startWizard = () => {
    setStep(1); setCorrectDev(''); setRefDev(''); setPaperName('');
    setSessionId(newSessionId());
    setPrintedRef(false); setPrintedCor(false); setPrintChart(null);
    setCfgRef(null); setCfgCorrect(null);
    setScanA(null); setScanB(null); setAnalysis(null);
    setFeedback(null); setView('wizard');
  };

  const startImport = () => {
    setCorrectDev(''); setRefDev(''); setPaperName('');
    setCubeText(null); setCubeInfo(null); setInformeText(null); setInformeCorrText(null);
    setFeedback(null); setView('import');
  };

  const onCubeFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    try {
      parseCube(text); // valida acá para avisar temprano
      setCubeText(text);
      setCubeInfo({ name: file.name, date: new Date(file.lastModified).toISOString() });
      notify('ok', 'Archivo .cube válido.');
    } catch (e) {
      setCubeText(null); setCubeInfo(null);
      notify('error', e.message);
    }
  };

  const runImport = async () => {
    if (!cubeText) { notify('error', 'Elegí el archivo .cube.'); return; }
    if (!correctDev || !refDev || correctDev === refDev) { notify('error', 'Elegí dos impresoras distintas.'); return; }
    const correctIp = ipOf(correctDev);
    if (!correctIp) { notify('error', 'La impresora a corregir no tiene IP. Asignásela a mano en la lista y volvé a intentar.'); return; }
    setBusy('import');
    try {
      const lut = parseCube(cubeText);
      let results = null;
      if (informeText) results = { ...parseInformePrevisto(informeText) };
      if (informeCorrText) results = { ...(results || {}), ...parseInformeReal(informeCorrText) };
      const cal = {
        id: 'cal-imp-' + Date.now().toString(36),
        engineVersion: 1,
        correctPrinter: {
          ip: correctIp, queue: correctDev,
          port: (printers.find((x) => x.name === correctDev) || {}).port || '',
        },
        referencePrinter: {
          ip: ipOf(refDev) || '', queue: refDev,
          port: (printers.find((x) => x.name === refDev) || {}).port || '',
        },
        paperName: paperName || '',
        lutSize: lut.S,
        lut: Array.from(lut.V),
        results,
        active: false,
        origen: 'importada',
        archivoOrigen: cubeInfo,
      };
      const sr = await api().save(cal);
      if (!sr.ok) throw new Error(sr.error || 'no se pudo guardar');
      await reload();
      setView('list');
      notify('ok', 'Calibración importada (queda desactivada). Activala con el botón Activar.');
    } catch (e) {
      notify('error', e.message);
    }
    setBusy('');
  };

  // Cada carta se manda con el MODAL DE IMPRESIÓN DE SIEMPRE: así se elige la
  // impresora y se entra a "Configurar impresora" como en cualquier trabajo, en
  // vez de imprimir en silencio con una configuración que el usuario no ve.
  const abrirImpresionCarta = (which) => {
    if (!refDev || !correctDev || refDev === correctDev) { notify('error', 'Elegí dos impresoras distintas.'); return; }
    setFeedback(null);
    setPrintChart(which);
  };

  const confirmarImpresionCarta = async ({ deviceName, copies }) => {
    const which = printChart;
    setPrintChart(null);
    if (!which) return;
    setBusy('print');
    try {
      const charts = renderCalibrationCharts(sessionId, {
        referencia: 'CARTA DE COLOR - REFERENCIA (' + refDev + ')',
        correccion: 'CARTA DE COLOR - A CORREGIR (' + correctDev + ')',
      });
      const r = await window.printlayout.pdf.print({
        images: [which === 'ref' ? charts.referencia : charts.correccion],
        pageWidthMm: 210, pageHeightMm: 297,
        deviceName, copies: copies || 1, showDialog: false,
        docName: which === 'ref' ? 'Carta color referencia' : 'Carta color a corregir',
        noColorCorrection: true,
      });
      if (!r.ok) throw new Error(r.error || 'falló');
      if (which === 'ref') setPrintedRef(true); else setPrintedCor(true);
      // Nos guardamos con qué configuración salió: el perfil vale para ESA.
      await leerConfig(which, deviceName);
      notify('ok', which === 'ref' ? 'Carta de referencia enviada.' : 'Carta a corregir enviada.');
    } catch (e) {
      notify('error', 'No se pudo imprimir la carta (' + e.message + ').');
    }
    setBusy('');
  };

  // Lee del driver qué papel/calidad/gestión de color tiene hoy esa impresora.
  const leerConfig = async (which, dev) => {
    try {
      const r = await window.printlayout.pdf.printerConfigInfo?.(dev);
      if (!r?.ok) return;
      const activa = (r.tieneApp && r.app) ? r.app : r.windows;
      if (which === 'ref') setCfgRef(activa); else setCfgCorrect(activa);
    } catch { /* si no se puede leer, seguimos sin el dato */ }
  };

  const onFiles = (files) => {
    const arr = Array.from(files || []).slice(0, 2);
    if (arr[0]) setScanA(arr[0]);
    if (arr[1]) setScanB(arr[1]);
    else if (arr[0] && !scanA) setScanA(arr[0]);
  };

  const runAnalyze = async () => {
    if (!scanA || !scanB) { notify('error', 'Cargá los DOS escaneos.'); return; }
    setBusy('analyze');
    setAnalysis(null);
    try {
      const res = await analyzePair(scanA, scanB);
      setAnalysis(res);
      setStep(5);
      notify('ok', 'Análisis listo. Revisá el informe y activá o descartá.');
    } catch (e) {
      notify('error', e.message || 'No se pudo analizar.');
    }
    setBusy('');
  };

  const activate = async () => {
    if (!analysis) return;
    const correctIp = ipOf(correctDev);
    const refIp = ipOf(refDev);
    if (!correctIp) { notify('error', 'La impresora a corregir no tiene IP. Asigná su IP a mano en la lista y volvé a intentar.'); return; }
    setBusy('save');
    const portOf = (name) => (printers.find((x) => x.name === name) || {}).port || '';
    const cal = {
      id: 'cal-' + sessionId + '-' + Date.now().toString(36),
      engineVersion: 1,
      // Guardamos también cola y puerto: sobreviven al cambio de IP y permiten
      // reconocer la impresora aunque el puerto quede con una IP vieja.
      correctPrinter: { ip: correctIp, queue: correctDev, port: portOf(correctDev) },
      referencePrinter: { ip: refIp || '', queue: refDev, port: portOf(refDev) },
      paperName: paperName || '',
      // Con qué configuración se imprimieron las cartas: el perfil vale para ESTA.
      config: cfgCorrect ? {
        papel: cfgCorrect.paper || '', tipo: cfgCorrect.media || '',
        calidad: cfgCorrect.quality || '', color: cfgCorrect.icm || '',
        colorOn: cfgCorrect.icmOn,
      } : null,
      lutSize: analysis.lutSize,
      lut: analysis.lut,
      results: analysis.stats ? {
        antesProm: analysis.stats.antesProm, previstoProm: analysis.stats.despuesProm,
        previstoMax: analysis.stats.p90D, fuera5: analysis.stats.fuera,
      } : null,
      active: true,
    };
    const sr = await api().save(cal);
    if (!sr.ok) { notify('error', sr.error || 'No se pudo guardar.'); setBusy(''); return; }
    await api().setActive(cal.id, true);
    await reload();
    setBusy('');
    setView('list');
    notify('ok', 'Corrección activada para ' + correctDev + '. Ya se aplica al imprimir a esa impresora.');
  };

  // Colas que no muestran IP y TODAVÍA no están asignadas. Las ya asignadas se
  // van a su propia lista (antes seguían acá y parecía que no se había guardado).
  const printersWithoutIp = printers.filter(
    (p) => !p.ip && !manualPrinter[p.name] && !/XPS|PDF|OneNote|Fax/i.test(p.name),
  );
  // Asignadas a mano, con la IP que tiene hoy la cola (para avisar si cambió).
  const asignadas = Object.keys(manualPrinter).sort().map((name) => ({
    name,
    rec: manualPrinter[name],
    ipAhora: (printers.find((p) => p.name === name) || {}).ip || null,
  }));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-[54rem] max-w-[96vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 p-4">
          <div>
            <h3 className="text-sm font-semibold text-ink-100">Calibración de color</h3>
            <p className="mt-1 text-xs text-ink-400">Hacé que una impresora imprima con los mismos colores que otra de referencia.</p>
          </div>
          <button onClick={onClose} className="rounded px-2 py-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100">✕</button>
        </div>

        {feedback && (
          <div className={'mx-4 mt-3 rounded px-3 py-2 text-xs ' + (feedback.kind === 'error' ? 'bg-red-950/60 text-red-300 border border-red-800' : 'bg-green-950/50 text-green-300 border border-green-800')}>
            {feedback.text}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {!loaded ? (
            <p className="text-xs text-ink-400">Cargando…</p>
          ) : view === 'list' ? (
            <ListView
              cals={cals} printers={printers} manualIp={manualIp} canShare={canShare} busy={busy}
              nameForIp={nameForIp} printersWithoutIp={printersWithoutIp} asignadas={asignadas}
              onCalibrate={startWizard} onImport={startImport} onToggle={toggleActive} onDelete={del} onShare={share}
              onDeleteShared={deleteShared} onPull={pull} onSetManual={setManual} fmtDate={fmtDate}
              onExportIcc={exportarPerfil}
              perfil={perfil} onCerrarPerfil={() => setPerfil(null)}
              onGuardarComo={guardarPerfilComo} onAbrirCarpeta={(id) => api().openPerfiles(id)}
              onGuardarCartas={guardarCartas} onMedir={startMedir}
              cartas={cartas} onCerrarCartas={() => setCartas(null)} onAbrirDir={(d) => api().openDir(d)}
            />
          ) : view === 'medir' ? (
            <MedirView
              cals={cals} busy={busy} nameForIp={nameForIp}
              medRef={medRef} setMedRef={setMedRef} medCor={medCor} setMedCor={setMedCor}
              resultado={medResultado} onMedir={runMedir}
              medCal={medCal} setMedCal={setMedCal} onGuardar={guardarMedicion}
              onVolver={() => setView('list')}
            />
          ) : view === 'import' ? (
            <ImportView
              printers={printers} busy={busy} ipOf={ipOf}
              correctDev={correctDev} setCorrectDev={setCorrectDev} refDev={refDev} setRefDev={setRefDev}
              paperName={paperName} setPaperName={setPaperName}
              cubeInfo={cubeInfo} onCubeFile={onCubeFile}
              informeText={informeText} setInformeText={setInformeText}
              informeCorrText={informeCorrText} setInformeCorrText={setInformeCorrText}
              runImport={runImport} onCancel={() => setView('list')}
            />
          ) : (
            <WizardView
              step={step} setStep={setStep} printers={printers} busy={busy}
              correctDev={correctDev} setCorrectDev={setCorrectDev} refDev={refDev} setRefDev={setRefDev}
              paperName={paperName} setPaperName={setPaperName}
              onImprimirCarta={abrirImpresionCarta} printedRef={printedRef} printedCor={printedCor}
              cfgRef={cfgRef} cfgCorrect={cfgCorrect}
              scanA={scanA} scanB={scanB} onFiles={onFiles} fileRef={fileRef}
              runAnalyze={runAnalyze} analysis={analysis} activate={activate}
              onCancel={() => setView('list')} ipOf={ipOf}
            />
          )}
        </div>
      </div>

      {/* El modal de impresión de SIEMPRE, con la impresora que corresponde ya
          elegida y su botón "Configurar impresora". */}
      <PrintModal
        open={!!printChart}
        title={printChart === 'ref' ? 'Imprimir carta de referencia' : 'Imprimir carta a corregir'}
        initialPrinter={printChart === 'ref' ? refDev : correctDev}
        noColorCorrection
        warnDriverColor
        rememberPrinter={false}
        onConfirm={confirmarImpresionCarta}
        onCancel={() => setPrintChart(null)}
      />
    </div>
  );
}

// Campo para asignar/cambiar la IP de una cola. Arranca mostrando lo que YA está
// guardado (antes salía siempre vacío y parecía que no se había guardado nada).
function AsignarIp({ valor, onGuardar, onCancelar, autoFocus }) {
  const [txt, setTxt] = useState(valor || '');
  useEffect(() => { setTxt(valor || ''); }, [valor]);
  return (
    <div className="flex items-center gap-1">
      <input
        value={txt}
        autoFocus={autoFocus}
        onChange={(e) => setTxt(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onGuardar(txt); if (e.key === 'Escape' && onCancelar) onCancelar(); }}
        placeholder="192.168.100.x"
        className="w-36 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
      />
      <button onClick={() => onGuardar(txt)} className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-800">Guardar</button>
      {onCancelar && <button onClick={onCancelar} className="rounded px-1.5 py-1 text-[11px] text-ink-400 hover:bg-ink-800">Cancelar</button>}
    </div>
  );
}

function ListView({ cals, printers, manualIp, canShare, busy, nameForIp, printersWithoutIp, asignadas = [], onCalibrate, onImport, onToggle, onDelete, onShare, onDeleteShared, onPull, onSetManual, fmtDate, onExportIcc, perfil, onCerrarPerfil, onGuardarComo, onAbrirCarpeta, onGuardarCartas, onMedir, cartas, onCerrarCartas, onAbrirDir }) {
  const manualRef = useRef(null);
  const [editando, setEditando] = useState(null); // cola que se está reasignando
  const localHasIp = (ip) => !!ip && (printers.some((p) => p.ip === ip) || Object.values(manualIp || {}).includes(ip));
  const scrollToManual = () => manualRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return (
    <>
      {cartas && (
        <div className="mb-3 rounded border border-ink-700 bg-ink-800/40 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-semibold text-ink-200">Cartas de prueba guardadas (sesión {cartas.sessionId})</div>
            <button onClick={onCerrarCartas} className="shrink-0 rounded px-1.5 text-xs text-ink-400 hover:bg-ink-800" title="Cerrar">✕</button>
          </div>
          <div className="mt-1 break-all font-mono text-[10px] text-ink-400">{cartas.dir}</div>
          <button onClick={() => onAbrirDir(cartas.dir)} className="mt-2 rounded border border-ink-700 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800">Abrir carpeta</button>
          <ul className="mt-2 ml-4 list-disc space-y-0.5 text-[11px] leading-snug text-ink-300">
            <li><b>Imprimí el PDF</b>, no el PNG: ya está en A4 a tamaño real.</li>
            <li>Sin ajustar a la página y <b>sin ninguna corrección de color</b>.</li>
            <li>La <b>1-REFERENCIA</b> va en la impresora buena; la <b>2-A-CORREGIR</b>, en la que estás corrigiendo.</li>
            <li>Escaneá las dos a 300 dpi, color, JPEG máxima calidad, sin ajustes automáticos.</li>
            <li>Después volvé acá y tocá <b>“Medir resultado”</b>.</li>
          </ul>
        </div>
      )}

      {perfil && (
        <div className="mb-3 rounded border border-sky-800 bg-sky-950/30 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-sky-200">Perfil guardado</div>
              <div className="mt-0.5 break-all font-mono text-[10px] text-ink-300">{perfil.fileName}</div>
            </div>
            <button onClick={onCerrarPerfil} className="shrink-0 rounded px-1.5 text-xs text-ink-400 hover:bg-ink-800" title="Cerrar">✕</button>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={onGuardarComo} className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800">Guardar como…</button>
            <button onClick={() => onAbrirCarpeta(perfil.id)} className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800">Abrir carpeta</button>
          </div>

          <div className="mt-3 space-y-2 text-[11px] leading-snug text-ink-300">
            <p className="text-ink-400">
              Al lado del perfil quedó un <b>.txt con estos mismos pasos</b>, por si lo necesitás en otra PC.
            </p>
            <div>
              <div className="font-semibold text-ink-200">Para usarlo desde Corel</div>
              <ol className="ml-4 list-decimal space-y-0.5">
                <li>Herramientas → Administración de color → cargar este perfil.</li>
                <li>Al imprimir, solapa <b>Color</b>: que convierta <b>Corel</b>, perfil de salida = este, intención <b>colorimétrico relativo</b>.</li>
                <li>En el driver: gestión de color <b>apagada</b> y los ajustes de color en 0.</li>
              </ol>
            </div>
            <div>
              <div className="font-semibold text-ink-200">Para usarlo en cualquier programa (y en el plóter Epson)</div>
              <ol className="ml-4 list-decimal space-y-0.5">
                <li>Panel de control → Administración de color → Dispositivos.</li>
                <li>Elegí la impresora → “Usar mi configuración para este dispositivo” → Agregar → este perfil, como predeterminado.</li>
                <li>En el driver: gestión de color en <b>ICM</b> (en el Epson, que lo maneje el driver).</li>
                <li>Acá <b>Corel no tiene que convertir</b>.</li>
              </ol>
            </div>
            <p className="rounded border border-amber-800/60 bg-amber-950/30 p-1.5 text-amber-200">
              <b>Elegí uno de los dos caminos, no los dos.</b> Si Corel convierte y además el perfil está
              puesto en la cola de Windows, el color se corrige dos veces y sale pasado de rosca.
              Imprimiendo <b>desde PrintLayout</b> no cambia nada: la app sigue corrigiendo por su cuenta.
            </p>
            <p className="text-ink-400">
              El perfil vale para el <b>papel y la calidad</b> con los que se calibró.
              {(() => {
                const c = cals.find((x) => x.id === perfil.id);
                const cfg = c && c.config;
                if (!cfg) return null;
                const partes = [cfg.papel, cfg.tipo, cfg.calidad, cfg.color ? 'color ' + cfg.color : '']
                  .filter((v) => v && String(v).trim());
                if (!partes.length) return null;
                return <> Esta se hizo con: <b className="text-ink-200">{partes.join(' · ')}</b>.</>;
              })()}
            </p>
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={onCalibrate} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500">Calibrar una impresora</button>
        <button onClick={onImport} className="rounded border border-ink-600 px-3 py-1.5 text-sm text-ink-100 hover:bg-ink-800">Importar calibración (.cube)</button>
        <button onClick={onGuardarCartas} disabled={busy === 'cartas'} title="Guarda las dos cartas de 343 colores en PNG y PDF a tamaño real, para imprimirlas desde Corel o cualquier programa" className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800 disabled:opacity-50">{busy === 'cartas' ? 'Guardando…' : 'Guardar carta de prueba'}</button>
        <button onClick={onMedir} className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800">Medir resultado</button>
        <button onClick={onPull} disabled={busy === 'pull'} className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800 disabled:opacity-50">{busy === 'pull' ? 'Actualizando…' : 'Actualizar (bajar de otras PC)'}</button>
      </div>

      {cals.length === 0 ? (
        <p className="text-xs text-ink-400">Todavía no hay calibraciones. Tocá “Calibrar una impresora” para empezar.</p>
      ) : (
        <div className="space-y-2">
          {cals.map((c) => (
            <div key={c.id} className="rounded border border-ink-700 bg-ink-950/40 p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className={'inline-block h-2.5 w-2.5 rounded-full ' + (c.active ? 'bg-green-400' : 'bg-ink-600')} />
                <b className="text-ink-100">{nameForIp(c.correctPrinter?.ip)}</b>
                <span className="text-ink-500">← como {nameForIp(c.referencePrinter?.ip)}</span>
                {c.sharedAt && <span className="ml-1 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300">compartida</span>}
                <span className="ml-auto text-[11px] text-ink-400">{fmtDate(c.createdAt)}{c.paperName ? ' · ' + c.paperName : ''}</span>
              </div>
              {c.results && (c.results.antesProm != null || c.results.realProm != null) && (
                <div className="mt-1 text-[11px] text-ink-400">
                  Diferencia de color: <b className="text-ink-200">{fmt1(c.results.antesProm)}</b> → previsto <b className="text-green-300">{fmt1(c.results.previstoProm)}</b>
                  {c.results.realProm != null && <span> · real <b className="text-green-200">{fmt1(c.results.realProm)}</b></span>}
                  {typeof c.results.fuera5 === 'number' && c.results.realProm == null && <span> · quedan {c.results.fuera5} con dif ≥5</span>}
                </div>
              )}
              {c.config && (c.config.papel || c.config.tipo || c.config.calidad || c.config.color) && (
                <div className="mt-1 text-[11px] text-ink-500">
                  Hecha con: {[c.config.papel, c.config.tipo, c.config.calidad,
                    c.config.color ? 'color ' + c.config.color : ''].filter(Boolean).join(' · ')}
                </div>
              )}
              {c.origen === 'importada' && <div className="text-[10px] text-ink-500">importada{c.archivoOrigen?.name ? ' de ' + c.archivoOrigen.name : ''}</div>}
              {!localHasIp(c.correctPrinter?.ip) && (
                <div className="mt-1 flex items-start gap-2 rounded border border-amber-700/50 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-300">
                  <span>Esta PC no tiene ninguna impresora con IP {c.correctPrinter?.ip || '(sin IP)'}: asignala en “Impresoras sin IP visible” o la corrección no se va a aplicar.</span>
                  <button onClick={scrollToManual} className="shrink-0 rounded border border-amber-700 px-1.5 py-0.5 text-[10px] hover:bg-amber-900/40">Asignar IP</button>
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => onToggle(c)} disabled={busy === 'active'} className={'rounded px-2 py-1 text-xs ' + (c.active ? 'border border-amber-700 text-amber-300 hover:bg-amber-950/40' : 'bg-green-700 text-white hover:bg-green-600')}>
                  {c.active ? 'Desactivar' : 'Activar'}
                </button>
                {canShare && !c.sharedAt && <button onClick={() => onShare(c)} disabled={busy === 'share'} className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800">Compartir</button>}
                {canShare && c.sharedAt && <button onClick={() => onShare(c)} disabled={busy === 'share'} className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800">Subir cambios</button>}
                {canShare && c.sharedAt && <button onClick={() => onDeleteShared(c)} disabled={busy === 'share'} className="rounded border border-red-800 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40">Borrar de todas</button>}
                <button onClick={() => onExportIcc(c)} disabled={busy === 'icc'} title="Guarda la corrección como perfil de color, para usarla desde Corel o desde cualquier programa" className="rounded border border-sky-800 px-2 py-1 text-xs text-sky-300 hover:bg-sky-950/40">
                  {busy === 'icc' ? 'Generando…' : 'Exportar perfil (.icc)'}
                </button>
                <button onClick={() => onDelete(c)} disabled={busy === 'del'} className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-400 hover:bg-ink-800">Borrar acá</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!canShare && (
        <p className="mt-3 text-[11px] text-ink-500">Compartir está deshabilitado en este equipo (falta el permiso/token de La Recta).</p>
      )}

      {asignadas.length > 0 && (
        <div className="mt-4 rounded border border-ink-700 bg-ink-950/40 p-3">
          <p className="text-xs font-medium text-ink-200">Impresoras asignadas a mano</p>
          <p className="mb-2 text-[11px] text-ink-500">
            La asignación es por <b>cola de impresión</b>, no por IP: aunque la máquina
            cambie de IP, se la sigue reconociendo.
          </p>
          {asignadas.map((a) => (
            <div key={a.name} className="mt-2 border-t border-ink-800 pt-2 first:mt-0 first:border-0 first:pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1 truncate text-xs text-ink-200" title={a.name}>{a.name}</span>
                {editando === a.name ? (
                  <AsignarIp
                    valor={a.rec.ip} autoFocus
                    onGuardar={(v) => { setEditando(null); onSetManual(a.name, v); }}
                    onCancelar={() => setEditando(null)}
                  />
                ) : (
                  <>
                    <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-green-300">{a.rec.ip || '(sin IP)'}</span>
                    <button onClick={() => setEditando(a.name)} className="rounded border border-ink-700 px-2 py-0.5 text-[11px] text-ink-200 hover:bg-ink-800">Cambiar</button>
                    <button onClick={() => onSetManual(a.name, '')} className="rounded border border-ink-700 px-2 py-0.5 text-[11px] text-ink-400 hover:bg-ink-800">Quitar</button>
                  </>
                )}
              </div>
              {a.rec.port && <div className="mt-0.5 font-mono text-[10px] text-ink-500">puerto: {a.rec.port}</div>}
              {a.ipAhora && a.rec.ip && a.ipAhora !== a.rec.ip && (
                <div className="mt-1 rounded border border-amber-700/50 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-300">
                  La IP cambió (antes {a.rec.ip}, ahora {a.ipAhora}). La asignación
                  sigue valiendo porque es por cola.
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {printersWithoutIp.length > 0 && (
        <div ref={manualRef} className="mt-4 rounded border border-ink-700 bg-ink-950/40 p-3">
          <p className="text-xs font-medium text-ink-200">Impresoras sin IP visible (asignalas a mano)</p>
          <p className="mb-2 text-[11px] text-ink-500">Algunas colas (WSD, EpsonNet) no muestran la IP. Escribí la IP de la máquina para que la corrección la reconozca; queda guardada contra esta cola.</p>
          {printersWithoutIp.map((p) => (
            <div key={p.name} className="mt-1 flex flex-wrap items-center gap-2">
              <span className="flex-1 truncate text-xs text-ink-300" title={p.name}>{p.name}</span>
              <AsignarIp valor="" onGuardar={(v) => onSetManual(p.name, v)} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// Un botón por carta, con la impresora a la que va y la configuración que tiene
// hoy. Si el driver va a "mejorar" el color, la medición queda mal: por eso el
// aviso en ámbar antes de imprimir y no después.
function CartaBoton({ etiqueta, dev, hecho, cfg, disabled, onClick }) {
  const dato = (v) => (v && String(v).trim() ? v : '—');
  return (
    <div className="rounded border border-ink-700 bg-ink-950/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onClick} disabled={disabled} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50">
          {etiqueta}
        </button>
        <span className="truncate text-[11px] text-ink-400" title={dev}>{dev || '—'}</span>
        {hecho && <span className="text-[11px] text-green-300">✓ enviada</span>}
      </div>
      {cfg && (
        <div className="mt-1 text-[11px] text-ink-400">
          Papel <b className="text-ink-200">{dato(cfg.paper)}</b>
          {' · '}Tipo <b className="text-ink-200">{dato(cfg.media)}</b>
          {' · '}Calidad <b className="text-ink-200">{dato(cfg.quality)}</b>
          {' · '}Color <b className={cfg.icmOn === true ? 'text-amber-300' : 'text-ink-200'}>{dato(cfg.icm)}</b>
        </div>
      )}
      {cfg && cfg.icmOn === true && (
        <div className="mt-1 rounded border border-amber-700/60 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-200">
          Esta impresora tiene la <b>gestión de color del driver encendida</b>. La carta
          tiene que salir <b>sin</b> gestión de color o la medición queda mal: apagala
          desde “Configurar impresora”, en el modal que se abre con el botón de arriba.
        </div>
      )}
    </div>
  );
}

function WizardView(props) {
  const {
    step, setStep, printers, busy, correctDev, setCorrectDev, refDev, setRefDev,
    paperName, setPaperName, onImprimirCarta, printedRef, printedCor, cfgRef, cfgCorrect,
    scanA, scanB, onFiles, fileRef, runAnalyze, analysis, activate, onCancel, ipOf,
  } = props;
  const realPrinters = printers.filter((p) => !/XPS|PDF|OneNote|Fax/i.test(p.name));
  const Stepper = () => (
    <div className="mb-3 flex items-center gap-1 text-[11px] text-ink-500">
      {['Impresoras', 'Papel', 'Imprimir', 'Escanear', 'Resultado'].map((s, i) => (
        <span key={s} className={'rounded px-2 py-0.5 ' + (step === i + 1 ? 'bg-blue-600 text-white' : step > i + 1 ? 'text-green-400' : '')}>{i + 1}. {s}</span>
      ))}
    </div>
  );
  return (
    <div>
      <Stepper />
      {step === 1 && (
        <div className="space-y-3">
          <p className="text-xs text-ink-400">Elegí la impresora que querés corregir y una de referencia (que imprime bien). Tienen que ser distintas.</p>
          <label className="block text-xs text-ink-300">Impresora a corregir
            <select value={correctDev} onChange={(e) => setCorrectDev(e.target.value)} className="mt-1 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100">
              <option value="">— elegir —</option>
              {realPrinters.map((p) => <option key={p.name} value={p.name}>{p.name}{p.ip ? ' (' + p.ip + ')' : ' (sin IP)'}</option>)}
            </select>
          </label>
          <label className="block text-xs text-ink-300">Impresora de referencia
            <select value={refDev} onChange={(e) => setRefDev(e.target.value)} className="mt-1 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100">
              <option value="">— elegir —</option>
              {realPrinters.map((p) => <option key={p.name} value={p.name}>{p.name}{p.ip ? ' (' + p.ip + ')' : ' (sin IP)'}</option>)}
            </select>
          </label>
          {correctDev && !ipOf(correctDev) && <p className="text-[11px] text-amber-300">La impresora a corregir no muestra IP. Podés seguir, pero antes de activar tendrás que asignarle la IP a mano en la lista.</p>}
          <div className="flex justify-between">
            <button onClick={onCancel} className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800">Cancelar</button>
            <button disabled={!correctDev || !refDev || correctDev === refDev} onClick={() => setStep(2)} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50">Siguiente</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-xs text-ink-400">
            Poné el MISMO papel (tipo, gramaje, bandeja, tamaño) en las dos impresoras.
            Acá solo anotás <b className="text-ink-200">cómo se llama</b>, para acordarte después.
          </p>
          <label className="block text-xs text-ink-300">Nombre del papel
            <input value={paperName} onChange={(e) => setPaperName(e.target.value)} placeholder='ej. Ilustración 150' className="mt-1 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100" />
          </label>
          <p className="rounded border border-ink-700 bg-ink-950/40 p-2 text-[11px] leading-snug text-ink-400">
            La configuración de verdad (papel, calidad, gestión de color) la elegís
            <b className="text-ink-200"> al imprimir</b>, en el paso siguiente, con el botón
            “Configurar impresora” del modal de impresión de siempre.
          </p>
          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800">Atrás</button>
            <button onClick={() => setStep(3)} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500">Siguiente</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="text-xs text-ink-400">Con las dos máquinas <b className="text-ink-200">calientes</b> (imprimí unas hojas antes), mandá la carta de color a cada una. Se abre el modal de impresión de siempre, con la impresora ya elegida.</p>
          <p className="rounded border border-amber-800/60 bg-amber-950/20 p-2 text-[11px] leading-snug text-amber-200">
            La calibración vale para el <b>papel y la calidad</b> con los que imprimas
            estas cartas. Si después trabajás con otra configuración, el perfil no corresponde.
          </p>

          <CartaBoton
            etiqueta="Imprimir carta de referencia" dev={refDev} hecho={printedRef}
            cfg={cfgRef} disabled={busy === 'print'} onClick={() => onImprimirCarta('ref')}
          />
          <CartaBoton
            etiqueta="Imprimir carta a corregir" dev={correctDev} hecho={printedCor}
            cfg={cfgCorrect} disabled={busy === 'print'} onClick={() => onImprimirCarta('correct')}
          />

          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800">Atrás</button>
            <button onClick={() => setStep(4)} className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800">Ya imprimí →</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <p className="text-xs text-ink-400">Escaneá las DOS hojas en la MISMA máquina, a 300 dpi, color, JPEG máxima calidad, la hoja entera y sin ajustes automáticos. Después arrastrá los dos archivos acá (no importa el orden: la app los reconoce por el código).</p>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
            onClick={() => fileRef.current?.click()}
            className="cursor-pointer rounded border-2 border-dashed border-ink-700 bg-ink-950/40 p-6 text-center text-xs text-ink-400 hover:border-ink-500">
            Arrastrá los 2 escaneos acá, o hacé clic para elegirlos.
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
          </div>
          <div className="text-[11px] text-ink-300">
            <div>1) {scanA ? scanA.name : '—'}</div>
            <div>2) {scanB ? scanB.name : '—'}</div>
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(3)} className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800">Atrás</button>
            <button onClick={runAnalyze} disabled={!scanA || !scanB || busy === 'analyze'} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50">
              {busy === 'analyze' ? 'Analizando…' : 'Analizar'}
            </button>
          </div>
        </div>
      )}

      {step === 5 && analysis && (
        <div className="space-y-3">
          <p className="text-xs text-ink-400">Esto es lo previsto según el escaneo. Si te convence, activá la corrección.</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-ink-700 bg-ink-950/60 p-3 text-[11px] leading-snug text-ink-200">{analysis.informe}</pre>
          <div className="flex justify-between">
            <button onClick={onCancel} className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800">Descartar</button>
            <button onClick={activate} disabled={busy === 'save'} className="rounded bg-green-700 px-3 py-1.5 text-sm text-white hover:bg-green-600 disabled:opacity-50">
              {busy === 'save' ? 'Guardando…' : 'Activar corrección'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportView({ printers, busy, ipOf, correctDev, setCorrectDev, refDev, setRefDev, paperName, setPaperName, cubeInfo, onCubeFile, informeText, setInformeText, informeCorrText, setInformeCorrText, runImport, onCancel }) {
  const realPrinters = printers.filter((p) => !/XPS|PDF|OneNote|Fax/i.test(p.name));
  const readTxt = async (file, setter) => { if (file) setter(await file.text()); };
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-400">¿Ya tenés una calibración hecha (un archivo .cube)? Cargala acá sin repetir todo el proceso.</p>

      <label className="block text-xs text-ink-300">Archivo .cube (la tabla de corrección)
        <input type="file" accept=".cube" onChange={(e) => onCubeFile(e.target.files?.[0])}
          className="mt-1 block w-full text-xs text-ink-300 file:mr-2 file:rounded file:border-0 file:bg-ink-700 file:px-3 file:py-1.5 file:text-ink-100" />
      </label>
      {cubeInfo && <p className="text-[11px] text-green-300">✓ {cubeInfo.name}</p>}

      <label className="block text-xs text-ink-300">Impresora a corregir
        <select value={correctDev} onChange={(e) => setCorrectDev(e.target.value)} className="mt-1 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100">
          <option value="">— elegir —</option>
          {realPrinters.map((p) => <option key={p.name} value={p.name}>{p.name}{p.ip ? ' (' + p.ip + ')' : ' (sin IP)'}</option>)}
        </select>
      </label>
      <label className="block text-xs text-ink-300">Impresora de referencia
        <select value={refDev} onChange={(e) => setRefDev(e.target.value)} className="mt-1 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100">
          <option value="">— elegir —</option>
          {realPrinters.map((p) => <option key={p.name} value={p.name}>{p.name}{p.ip ? ' (' + p.ip + ')' : ' (sin IP)'}</option>)}
        </select>
      </label>
      {correctDev && !ipOf(correctDev) && <p className="text-[11px] text-amber-300">La impresora a corregir no muestra IP. Asignásela a mano en la lista antes de importar.</p>}

      <label className="block text-xs text-ink-300">Nombre del papel (opcional)
        <input value={paperName} onChange={(e) => setPaperName(e.target.value)} placeholder='ej. Ilustración 150' className="mt-1 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100" />
      </label>

      <div className="rounded border border-ink-800 bg-ink-950/40 p-2">
        <p className="mb-1 text-[11px] text-ink-400">Opcional: cargá los informes para ver los números (antes → previsto → real). Si no, se importa igual.</p>
        <label className="block text-[11px] text-ink-400">informe.txt (previsto)
          <input type="file" accept=".txt" onChange={(e) => readTxt(e.target.files?.[0], setInformeText)} className="mt-0.5 block w-full text-[11px] text-ink-400 file:mr-2 file:rounded file:border-0 file:bg-ink-800 file:px-2 file:py-1 file:text-ink-200" />
        </label>
        {informeText && <span className="text-[10px] text-green-300">✓ previsto cargado</span>}
        <label className="mt-1 block text-[11px] text-ink-400">informe-corregida.txt (real)
          <input type="file" accept=".txt" onChange={(e) => readTxt(e.target.files?.[0], setInformeCorrText)} className="mt-0.5 block w-full text-[11px] text-ink-400 file:mr-2 file:rounded file:border-0 file:bg-ink-800 file:px-2 file:py-1 file:text-ink-200" />
        </label>
        {informeCorrText && <span className="text-[10px] text-green-300">✓ real cargado</span>}
      </div>

      <div className="flex justify-between">
        <button onClick={onCancel} className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800">Cancelar</button>
        <button onClick={runImport} disabled={busy === 'import'} className="rounded bg-green-700 px-3 py-1.5 text-sm text-white hover:bg-green-600 disabled:opacity-50">
          {busy === 'import' ? 'Importando…' : 'Importar (queda desactivada)'}
        </button>
      </div>
    </div>
  );
}

function fmt1(n) { return typeof n === 'number' ? n.toFixed(1).replace('.', ',') : '—'; }

// ── Medir resultado ──────────────────────────────────────────────────────────
// Lo que faltaba del kit: comprobar lo que salió DE VERDAD. Se cargan el
// escaneo de la carta de referencia y el de la corregida (vengan de PrintLayout
// o impresas desde Corel) y se muestra el informe real.
function MedirView({
  cals, busy, nameForIp, medRef, setMedRef, medCor, setMedCor,
  resultado, onMedir, medCal, setMedCal, onGuardar, onVolver,
}) {
  const archivo = (f) => (f ? `${f.name} (${Math.round(f.size / 1024)} KB)` : 'ningún archivo');
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onVolver} className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 hover:bg-ink-800">← Volver</button>
        <h3 className="text-sm font-semibold text-ink-100">Medir resultado</h3>
      </div>

      <p className="mb-3 text-xs leading-snug text-ink-400">
        Compara lo que salió DE VERDAD contra la impresora de referencia. Sirve igual si la
        carta la imprimiste desde PrintLayout o desde Corel con el perfil puesto. Las dos
        cartas tienen que ser de la <b>misma sesión</b> (lo dice el código de abajo de la hoja).
      </p>

      <div className="space-y-3">
        <div className="rounded border border-ink-700 bg-ink-800/40 p-2">
          <div className="text-xs font-medium text-ink-200">1) Escaneo de la carta de REFERENCIA</div>
          <div className="mt-0.5 text-[11px] text-ink-500">La impresora buena, la que querés imitar.</div>
          <input
            type="file" accept="image/*"
            onChange={(e) => setMedRef(e.target.files?.[0] || null)}
            className="mt-1.5 w-full text-xs text-ink-300 file:mr-2 file:rounded file:border file:border-ink-700 file:bg-ink-800 file:px-2 file:py-1 file:text-xs file:text-ink-200"
          />
          <div className="mt-1 text-[10px] text-ink-500">{archivo(medRef)}</div>
        </div>

        <div className="rounded border border-ink-700 bg-ink-800/40 p-2">
          <div className="text-xs font-medium text-ink-200">2) Escaneo de la carta CORREGIDA</div>
          <div className="mt-0.5 text-[11px] text-ink-500">La impresora que estás corrigiendo, ya con la corrección aplicada.</div>
          <input
            type="file" accept="image/*"
            onChange={(e) => setMedCor(e.target.files?.[0] || null)}
            className="mt-1.5 w-full text-xs text-ink-300 file:mr-2 file:rounded file:border file:border-ink-700 file:bg-ink-800 file:px-2 file:py-1 file:text-xs file:text-ink-200"
          />
          <div className="mt-1 text-[10px] text-ink-500">{archivo(medCor)}</div>
        </div>

        <button
          onClick={onMedir}
          disabled={!medRef || !medCor || busy === 'medir'}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy === 'medir' ? 'Midiendo…' : 'Medir'}
        </button>
      </div>

      {resultado && (
        <div className="mt-4">
          <pre className="max-h-80 overflow-auto rounded border border-ink-700 bg-ink-900 p-2 text-[10px] leading-snug text-ink-200">
            {resultado.informe}
          </pre>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-400">Guardar este resultado en:</span>
            <select
              value={medCal}
              onChange={(e) => setMedCal(e.target.value)}
              className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-200"
            >
              <option value="">(elegí una calibración)</option>
              {cals.map((c) => (
                <option key={c.id} value={c.id}>
                  {nameForIp(c.correctPrinter?.ip)} ← {nameForIp(c.referencePrinter?.ip)}
                </option>
              ))}
            </select>
            <button
              onClick={onGuardar}
              disabled={!medCal || busy === 'medir'}
              className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
