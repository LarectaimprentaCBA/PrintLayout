import { useEffect, useMemo, useRef, useState } from 'react';
import { newSessionId } from '../lib/colorCalibration/code.js';
import { renderCalibrationCharts } from '../lib/colorCalibration/chart.js';
import { analyzePair, parseCube, parseInformePrevisto, parseInformeReal } from '../lib/colorCalibration/analyze.js';

// Asistente de calibración de color por impresora. Corrige una impresora "pálida" para
// que imprima como una de referencia. La identidad de la impresora es su IP (el nombre de
// cola cambia entre PC). Todo dentro de PrintLayout. Ver electron/color/* + src/lib/colorCalibration/*.

const api = () => (typeof window !== 'undefined' ? window.printlayout?.color : null);
const fmtDate = (s) => { try { return new Date(s).toLocaleDateString(); } catch { return ''; } };

export default function ColorCalModal({ open, onClose }) {
  const [printers, setPrinters] = useState([]);
  const [cals, setCals] = useState([]);
  const [manualIp, setManualIp] = useState({});
  const [canShare, setCanShare] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState(null); // {kind,text}

  const [view, setView] = useState('list'); // 'list' | 'wizard'
  // Wizard
  const [step, setStep] = useState(1);
  const [correctDev, setCorrectDev] = useState('');
  const [refDev, setRefDev] = useState('');
  const [paperName, setPaperName] = useState('');
  const [refDevmode, setRefDevmode] = useState(null);
  const [correctDevmode, setCorrectDevmode] = useState(null);
  const [sessionId, setSessionId] = useState(0);
  const [printedCharts, setPrintedCharts] = useState(false);
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
    setCanShare(!!cs.canShare);
    setLoaded(true);
  };

  useEffect(() => { if (open) { setLoaded(false); setFeedback(null); setView('list'); reload(); } }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const ipOf = useMemo(() => (name) => {
    const p = printers.find((x) => x.name === name);
    return (p && p.ip) || manualIp[name] || null;
  }, [printers, manualIp]);

  const nameForIp = useMemo(() => (ip) => {
    const p = printers.find((x) => x.ip === ip) || printers.find((x) => manualIp[x.name] === ip);
    return p ? p.name : ip;
  }, [printers, manualIp]);

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
  const pull = async () => {
    setBusy('pull');
    const r = await api().syncPull();
    notify(r.ok ? 'ok' : 'error', r.ok ? `Actualizado (${r.added} nuevas, ${r.updated} actualizadas, ${r.removed} borradas).` : (r.error || 'No se pudo actualizar.'));
    await reload();
    setBusy('');
  };
  const setManual = async (queue, ip) => {
    await api().setManualIp(queue, ip.trim());
    await reload();
  };

  // ── Wizard ──────────────────────────────────────────────────────────────────
  const startWizard = () => {
    setStep(1); setCorrectDev(''); setRefDev(''); setPaperName('');
    setRefDevmode(null); setCorrectDevmode(null); setSessionId(newSessionId());
    setPrintedCharts(false); setScanA(null); setScanB(null); setAnalysis(null);
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
        correctPrinter: { ip: correctIp, queue: correctDev },
        referencePrinter: { ip: ipOf(refDev) || '', queue: refDev },
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

  const configurePaper = async (which) => {
    const dev = which === 'ref' ? refDev : correctDev;
    if (!dev) return;
    setBusy('paper');
    const r = await api().configurePaper(dev);
    setBusy('');
    if (r.canceled) return;
    if (!r.ok) { notify('error', r.error || 'No se pudo abrir Preferencias.'); return; }
    if (which === 'ref') setRefDevmode(r.devmodeB64); else setCorrectDevmode(r.devmodeB64);
    notify('ok', 'Papel elegido para ' + (which === 'ref' ? 'la de referencia' : 'la que se corrige') + '.');
  };

  const printCharts = async () => {
    if (!refDev || !correctDev || refDev === correctDev) { notify('error', 'Elegí dos impresoras distintas.'); return; }
    setBusy('print');
    try {
      const charts = renderCalibrationCharts(sessionId, {
        referencia: 'CARTA DE COLOR - REFERENCIA (' + refDev + ')',
        correccion: 'CARTA DE COLOR - A CORREGIR (' + correctDev + ')',
      });
      const doPrint = (dataUrl, deviceName, devmodeB64, docName) => window.printlayout.pdf.print({
        images: [dataUrl], pageWidthMm: 210, pageHeightMm: 297,
        deviceName, copies: 1, showDialog: false, docName, devmodeB64, noColorCorrection: true,
      });
      const r1 = await doPrint(charts.referencia, refDev, refDevmode, 'Carta color referencia');
      if (!r1.ok) throw new Error('referencia: ' + (r1.error || 'falló'));
      const r2 = await doPrint(charts.correccion, correctDev, correctDevmode, 'Carta color a corregir');
      if (!r2.ok) throw new Error('a corregir: ' + (r2.error || 'falló'));
      setPrintedCharts(true);
      notify('ok', 'Cartas enviadas. Con las máquinas calientes, imprimí y después escaneá las dos.');
      setStep(4);
    } catch (e) {
      notify('error', 'No se pudo imprimir la carta (' + e.message + ').');
    }
    setBusy('');
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
    const cal = {
      id: 'cal-' + sessionId + '-' + Date.now().toString(36),
      engineVersion: 1,
      correctPrinter: { ip: correctIp, queue: correctDev },
      referencePrinter: { ip: refIp || '', queue: refDev },
      paperName: paperName || '',
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

  const printersWithoutIp = printers.filter((p) => !p.ip && !/XPS|PDF|OneNote|Fax/i.test(p.name));

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
              nameForIp={nameForIp} printersWithoutIp={printersWithoutIp}
              onCalibrate={startWizard} onImport={startImport} onToggle={toggleActive} onDelete={del} onShare={share}
              onDeleteShared={deleteShared} onPull={pull} onSetManual={setManual} fmtDate={fmtDate}
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
              refDevmode={refDevmode} correctDevmode={correctDevmode} configurePaper={configurePaper}
              printCharts={printCharts} printedCharts={printedCharts}
              scanA={scanA} scanB={scanB} onFiles={onFiles} fileRef={fileRef}
              runAnalyze={runAnalyze} analysis={analysis} activate={activate}
              onCancel={() => setView('list')} ipOf={ipOf}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ListView({ cals, printers, canShare, busy, nameForIp, printersWithoutIp, onCalibrate, onImport, onToggle, onDelete, onShare, onDeleteShared, onPull, onSetManual, fmtDate }) {
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={onCalibrate} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500">Calibrar una impresora</button>
        <button onClick={onImport} className="rounded border border-ink-600 px-3 py-1.5 text-sm text-ink-100 hover:bg-ink-800">Importar calibración (.cube)</button>
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
              {c.origen === 'importada' && <div className="text-[10px] text-ink-500">importada{c.archivoOrigen?.name ? ' de ' + c.archivoOrigen.name : ''}</div>}
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => onToggle(c)} disabled={busy === 'active'} className={'rounded px-2 py-1 text-xs ' + (c.active ? 'border border-amber-700 text-amber-300 hover:bg-amber-950/40' : 'bg-green-700 text-white hover:bg-green-600')}>
                  {c.active ? 'Desactivar' : 'Activar'}
                </button>
                {canShare && !c.sharedAt && <button onClick={() => onShare(c)} disabled={busy === 'share'} className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800">Compartir</button>}
                {canShare && c.sharedAt && <button onClick={() => onShare(c)} disabled={busy === 'share'} className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800">Subir cambios</button>}
                {canShare && c.sharedAt && <button onClick={() => onDeleteShared(c)} disabled={busy === 'share'} className="rounded border border-red-800 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40">Borrar de todas</button>}
                <button onClick={() => onDelete(c)} disabled={busy === 'del'} className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-400 hover:bg-ink-800">Borrar acá</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!canShare && (
        <p className="mt-3 text-[11px] text-ink-500">Compartir está deshabilitado en este equipo (falta el permiso/token de La Recta).</p>
      )}

      {printersWithoutIp.length > 0 && (
        <div className="mt-4 rounded border border-ink-700 bg-ink-950/40 p-3">
          <p className="text-xs font-medium text-ink-200">Impresoras sin IP visible (asigná su IP a mano)</p>
          <p className="mb-2 text-[11px] text-ink-500">Algunas colas (WSD/red) no muestran la IP. Escribí la IP de la máquina para que la corrección la reconozca.</p>
          {printersWithoutIp.map((p) => (
            <div key={p.name} className="mt-1 flex items-center gap-2">
              <span className="flex-1 truncate text-xs text-ink-300" title={p.name}>{p.name}</span>
              <input defaultValue={p.ip || ''} placeholder="192.168.100.x" onBlur={(e) => onSetManual(p.name, e.target.value)}
                className="w-40 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function WizardView(props) {
  const {
    step, setStep, printers, busy, correctDev, setCorrectDev, refDev, setRefDev,
    paperName, setPaperName, refDevmode, correctDevmode, configurePaper,
    printCharts, printedCharts, scanA, scanB, onFiles, fileRef, runAnalyze, analysis, activate, onCancel, ipOf,
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
          <p className="text-xs text-ink-400">Elegí el MISMO papel (tipo, gramaje, bandeja, tamaño) en las dos impresoras. Se guarda solo para esta calibración, no cambia la configuración normal.</p>
          <label className="block text-xs text-ink-300">Nombre del papel (para acordarte)
            <input value={paperName} onChange={(e) => setPaperName(e.target.value)} placeholder='ej. Ilustración 150' className="mt-1 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => configurePaper('ref')} disabled={busy === 'paper'} className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800">
              Papel de la referencia {refDevmode ? '✓' : ''}
            </button>
            <button onClick={() => configurePaper('correct')} disabled={busy === 'paper'} className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800">
              Papel de la que se corrige {correctDevmode ? '✓' : ''}
            </button>
          </div>
          <p className="text-[11px] text-ink-500">Si no elegís papel, se usa el que tenga cada impresora por defecto (igual sirve si es el mismo en las dos).</p>
          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800">Atrás</button>
            <button onClick={() => setStep(3)} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500">Siguiente</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="text-xs text-ink-400">Con las dos máquinas <b className="text-ink-200">calientes</b> (imprimí unas hojas antes), mandá la carta de color a las dos. Sale una hoja en cada una.</p>
          <button onClick={printCharts} disabled={busy === 'print'} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50">
            {busy === 'print' ? 'Enviando…' : 'Imprimir las dos cartas'}
          </button>
          {printedCharts && <p className="text-[11px] text-green-300">Cartas enviadas.</p>}
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
