import { useEffect, useRef, useState } from 'react';

// Panel "Pedidos de fotos": configura la conexión a Supabase y controla el
// servicio de entrada automática. Muestra estado en vivo + log, y permite
// "Probar conexión" y "Buscar ahora". El servicio sólo ARMA y deja la hoja
// abierta para revisar (nunca imprime/corta solo).

const EMPTY = {
  supabaseUrl: '', serviceKey: '', pollSeconds: 60, outputDir: '', activo: false, modoEntrega: 'carpeta',
  dobbleActive: false, dobbleComboTemplateId: '', dobbleOutputDir: '', dobbleMazoPdfMap: {},
};

export default function IntakePanelModal({ open, onClose, onPublishCatalog }) {
  const [cfg, setCfg] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [feedback, setFeedback] = useState(null); // { kind, text }
  const [status, setStatus] = useState(null); // { activo, busy, pollSeconds, lastRun }
  const [logs, setLogs] = useState([]);
  const [comboTemplates, setComboTemplates] = useState([]); // combos (pages=[A,A,B])
  const [mazoRows, setMazoRows] = useState([]); // catálogo: [{ mazoId, pdfPath }]
  const logBoxRef = useRef(null);

  const api = typeof window !== 'undefined' ? window.printlayout?.intake : null;

  // Cargar config al abrir.
  useEffect(() => {
    if (!open || !api) return;
    setLoaded(false);
    setFeedback(null);
    api.getConfig().then((c) => {
      setCfg({ ...EMPTY, ...(c || {}) });
      setMazoRows(Object.entries((c && c.dobbleMazoPdfMap) || {}).map(([mazoId, pdfPath]) => ({ mazoId, pdfPath })));
      setStatus({ activo: !!c?.activo, pollSeconds: c?.pollSeconds ?? 60, busy: false });
      setLoaded(true);
    });
    // Plantillas combo Dobble guardadas (multi-hoja pages=[A,A,B]) para el selector.
    window.printlayout?.templates?.list?.().then((list) => {
      const combos = (Array.isArray(list) ? list : []).filter(
        (t) => Array.isArray(t?.pages) && t.pages.length > 1,
      );
      setComboTemplates(combos);
    }).catch(() => setComboTemplates([]));
  }, [open, api]);

  // Suscripción a estado + log mientras el panel está abierto.
  useEffect(() => {
    if (!open || !api) return undefined;
    const offStatus = api.onStatus?.((s) => setStatus((prev) => ({ ...prev, ...s })));
    const offLog = api.onLog?.((l) => setLogs((prev) => [...prev.slice(-80), l]));
    return () => { offStatus?.(); offLog?.(); };
  }, [open, api]);

  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const patch = (p) => setCfg((c) => ({ ...c, ...p }));

  // Filas del mapa mazo_id → PDF (catálogo).
  const rowsToMap = (rows) => Object.fromEntries(
    rows
      .map((r) => [String(r.mazoId || '').trim(), String(r.pdfPath || '').trim()])
      .filter(([k, v]) => k && v),
  );
  // Config que se persiste: incluye el mapa armado desde las filas.
  const buildCfg = () => ({ ...cfg, dobbleMazoPdfMap: rowsToMap(mazoRows) });
  const setMazoRow = (i, p) => setMazoRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const addMazoRow = () => setMazoRows((rows) => [...rows, { mazoId: '', pdfPath: '' }]);
  const removeMazoRow = (i) => setMazoRows((rows) => rows.filter((_, idx) => idx !== i));
  const chooseMazoPdf = async (i) => {
    const r = await window.printlayout?.dobble?.choosePdf?.();
    if (r?.ok && r.path) setMazoRow(i, { pdfPath: r.path });
  };

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const r = await api.setConfig(buildCfg());
      if (r?.ok) {
        setCfg({ ...EMPTY, ...r.config });
        setMazoRows(Object.entries(r.config?.dobbleMazoPdfMap || {}).map(([mazoId, pdfPath]) => ({ mazoId, pdfPath })));
        setFeedback({ kind: 'ok', text: 'Configuración guardada.' });
      } else {
        setFeedback({ kind: 'err', text: r?.error || 'No se pudo guardar.' });
      }
    } finally {
      setSaving(false);
    }
  };

  const chooseDir = async () => {
    const r = await api.chooseDir?.();
    if (r?.ok && r.path) patch({ outputDir: r.path });
  };

  const chooseDobbleDir = async () => {
    const r = await api.chooseDir?.();
    if (r?.ok && r.path) patch({ dobbleOutputDir: r.path });
  };

  const testConnection = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      // Guardamos primero para probar con lo que está en pantalla.
      await api.setConfig(buildCfg());
      const r = await api.testConnection();
      setFeedback(
        r?.ok
          ? { kind: 'ok', text: `Conexión OK. ${r.pending ?? 0} pedido(s) pendiente(s).` }
          : { kind: 'err', text: `Falló: ${r?.error || 'sin detalle'}` },
      );
    } finally {
      setTesting(false);
    }
  };

  const pollNow = async () => {
    setPolling(true);
    setFeedback(null);
    try {
      await api.setConfig(buildCfg());
      const r = await api.pollNow();
      setFeedback(
        r?.ok
          ? { kind: 'ok', text: `Búsqueda OK. ${r.found ?? 0} pedido(s) nuevo(s) en proceso.` }
          : { kind: 'err', text: `Falló: ${r?.error || 'sin detalle'}` },
      );
    } finally {
      setPolling(false);
    }
  };

  const publishCatalog = async () => {
    if (!onPublishCatalog) return;
    setPublishing(true);
    setFeedback(null);
    try {
      const r = await onPublishCatalog();
      setFeedback(
        r?.ok
          ? { kind: 'ok', text: `Catálogo publicado (${r.count ?? 0} fila/s).` }
          : { kind: 'err', text: `Falló: ${r?.error || 'sin detalle'}` },
      );
    } finally {
      setPublishing(false);
    }
  };

  const fbColor = feedback?.kind === 'ok'
    ? 'text-green-300'
    : feedback?.kind === 'err'
      ? 'text-red-300'
      : 'text-ink-300';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-[42rem] max-w-[95vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="border-b border-ink-700 p-4">
          <h3 className="text-sm font-semibold text-ink-100">Pedidos de fotos (entrada automática)</h3>
          <p className="mt-1 text-xs text-ink-400">
            Baja los pedidos cargados en la web cada cierto tiempo y arma una hoja
            por tamaño, lista para que la revises. Nunca imprime ni corta solo.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!loaded ? (
            <p className="text-xs text-ink-400">Cargando…</p>
          ) : (
            <>
              <label className="mb-3 flex cursor-pointer items-center gap-2 rounded border border-ink-700 bg-ink-950/40 px-3 py-2 text-xs text-ink-200">
                <input
                  type="checkbox"
                  checked={!!cfg.laRecta}
                  onChange={(e) => patch({ laRecta: e.target.checked })}
                  className="h-4 w-4 accent-accent-500"
                />
                <span>
                  <span className="font-medium text-ink-100">Esta PC es de La Recta</span>
                  <span className="block text-[11px] text-ink-400">
                    Habilita bajar pedidos y administrar/publicar las planchas oficiales. En las demás PCs dejalo destildado.
                  </span>
                </span>
              </label>

              <label className="block text-xs text-ink-300">
                <span className="mb-1 block">URL de Supabase</span>
                <input
                  value={cfg.supabaseUrl}
                  onChange={(e) => patch({ supabaseUrl: e.target.value })}
                  placeholder="https://xxxx.supabase.co"
                  className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                />
              </label>

              <label className="mt-3 block text-xs text-ink-300">
                <span className="mb-1 block">Clave de servicio (service key)</span>
                <input
                  type="password"
                  value={cfg.serviceKey}
                  onChange={(e) => patch({ serviceKey: e.target.value })}
                  placeholder="se guarda solo en esta PC"
                  autoComplete="off"
                  className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                />
              </label>

              <label className="mt-3 block text-xs text-ink-300">
                <span className="mb-1 block">Carpeta de salida (temporal de descargas)</span>
                <div className="flex gap-2">
                  <input
                    value={cfg.outputDir}
                    onChange={(e) => patch({ outputDir: e.target.value })}
                    placeholder="Vacío = carpeta por defecto de la app"
                    className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                  <button
                    type="button"
                    onClick={chooseDir}
                    className="shrink-0 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700"
                  >
                    Elegir…
                  </button>
                </div>
              </label>

              {/* Modo de entrega */}
              <div className="mt-3 rounded border border-ink-700 bg-ink-950/40 px-3 py-2 text-xs text-ink-300">
                <span className="mb-1 block font-medium text-ink-200">Cuando llega un pedido</span>
                <label className="flex cursor-pointer items-center gap-2 py-0.5">
                  <input
                    type="radio"
                    name="modoEntrega"
                    checked={cfg.modoEntrega !== 'carpeta'}
                    onChange={() => patch({ modoEntrega: 'abrir' })}
                    className="h-3.5 w-3.5 accent-accent-500"
                  />
                  <span>Abrir para revisar</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 py-0.5">
                  <input
                    type="radio"
                    name="modoEntrega"
                    checked={cfg.modoEntrega === 'carpeta'}
                    onChange={() => patch({ modoEntrega: 'carpeta' })}
                    className="h-3.5 w-3.5 accent-accent-500"
                  />
                  <span>Guardar como .pljob en la carpeta</span>
                </label>
                <span className="mt-1 block text-[10px] text-ink-500">
                  "Guardar" deja un archivo por hoja en la subcarpeta <b>Pedidos</b> de la carpeta de salida, sin abrir pestañas. Cada .pljob ya lleva las fotos adentro: lo abrís cuando quieras.
                </span>
              </div>

              {/* Pedidos busca2 (exportador TOTALMENTE automático) */}
              <div className="mt-3 rounded border border-accent-500/30 bg-accent-500/5 px-3 py-2 text-xs text-ink-300">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!cfg.dobbleActive}
                    onChange={(e) => patch({ dobbleActive: e.target.checked })}
                    className="h-4 w-4 accent-accent-500"
                  />
                  <span>
                    <span className="font-medium text-ink-100">Procesar pedidos busca2</span>
                    <span className="block text-[11px] text-ink-400">
                      De los mazos del cliente arma el combo de 3 hojas y exporta el PDF; de los mazos del catálogo copia el PDF ya hecho. Todo a la carpeta y marca procesado, sin intervención.
                    </span>
                  </span>
                </label>

                <label className="mt-3 block">
                  <span className="mb-1 block text-ink-300">Plantilla combo por defecto (mazos del cliente)</span>
                  <select
                    value={cfg.dobbleComboTemplateId || ''}
                    onChange={(e) => patch({ dobbleComboTemplateId: e.target.value })}
                    className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                  >
                    <option value="">— Elegí un combo guardado —</option>
                    {comboTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name || t.id} ({t.pages.length} hojas)
                      </option>
                    ))}
                  </select>
                  {comboTemplates.length === 0 && (
                    <span className="mt-1 block text-[10px] text-amber-300">
                      No hay combos de 3 hojas guardados todavía.
                    </span>
                  )}
                </label>

                <label className="mt-3 block">
                  <span className="mb-1 block text-ink-300">Carpeta de salida de los PDF busca2</span>
                  <div className="flex gap-2">
                    <input
                      value={cfg.dobbleOutputDir || ''}
                      onChange={(e) => patch({ dobbleOutputDir: e.target.value })}
                      placeholder="Ej: D:\Pedidos busca2"
                      className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                    />
                    <button
                      type="button"
                      onClick={chooseDobbleDir}
                      className="shrink-0 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700"
                    >
                      Elegir…
                    </button>
                  </div>
                  <span className="mt-1 block text-[10px] text-ink-500">
                    El PDF se guarda como <b>PR-&lt;presupuesto&gt; - &lt;nombre del mazo&gt;.pdf</b>, sin abrir ni preguntar nada.
                  </span>
                </label>

                {/* Mazos del catálogo (PDF ya armado) → mapa mazo_id → PDF */}
                <div className="mt-3 border-t border-ink-700/60 pt-3">
                  <span className="mb-1 block font-medium text-ink-200">Mazos del catálogo (PDF ya armado)</span>
                  <span className="mb-2 block text-[10px] text-ink-500">
                    Para los mazos nuestros (ej. el mundialista): en vez de generar, se copia este PDF a la carpeta. Asociá cada <b>mazo_id</b> con su archivo PDF.
                  </span>
                  {mazoRows.map((row, i) => (
                    <div key={i} className="mb-1.5 flex items-center gap-2">
                      <input
                        value={row.mazoId}
                        onChange={(e) => setMazoRow(i, { mazoId: e.target.value })}
                        placeholder="mazo_id"
                        className="w-28 shrink-0 rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-100 outline-none focus:border-accent-500"
                      />
                      <input
                        value={row.pdfPath}
                        onChange={(e) => setMazoRow(i, { pdfPath: e.target.value })}
                        placeholder="Ruta del PDF…"
                        className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-100 outline-none focus:border-accent-500"
                      />
                      <button
                        type="button"
                        onClick={() => chooseMazoPdf(i)}
                        className="shrink-0 rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-100 hover:bg-ink-700"
                      >
                        PDF…
                      </button>
                      <button
                        type="button"
                        onClick={() => removeMazoRow(i)}
                        title="Quitar"
                        className="shrink-0 rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 hover:bg-ink-700"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addMazoRow}
                    className="mt-1 rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-700"
                  >
                    + Agregar mazo
                  </button>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-ink-300">
                  <span>Revisar cada</span>
                  <input
                    type="number"
                    min="15"
                    value={cfg.pollSeconds}
                    onChange={(e) => patch({ pollSeconds: e.target.value })}
                    className="w-20 rounded border border-ink-700 bg-ink-800 px-2 py-1 text-center text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                  <span>segundos (mín. 15)</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-200">
                  <input
                    type="checkbox"
                    checked={!!cfg.activo}
                    onChange={(e) => patch({ activo: e.target.checked })}
                    className="h-4 w-4 accent-accent-500"
                  />
                  <span>Servicio activo</span>
                </label>
              </div>

              {/* Estado en vivo */}
              <div className="mt-4 rounded border border-ink-700 bg-ink-950/40 p-2 text-[11px] text-ink-300">
                <span className={status?.activo ? 'text-green-400' : 'text-ink-500'}>
                  ● {status?.activo ? 'Activo' : 'En pausa'}
                </span>
                {status?.busy && <span className="ml-3 text-accent-400">buscando…</span>}
                <span className="ml-3 text-ink-500">cada {status?.pollSeconds ?? cfg.pollSeconds}s</span>
                {status?.lastRun && (
                  <span className="ml-3 text-ink-500">
                    último: {new Date(status.lastRun).toLocaleTimeString()}
                  </span>
                )}
              </div>

              {/* Log */}
              <div
                ref={logBoxRef}
                className="mt-2 h-32 overflow-y-auto rounded border border-ink-800 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-ink-400"
              >
                {logs.length === 0 ? (
                  <span className="text-ink-600">Sin actividad todavía.</span>
                ) : (
                  logs.map((l, i) => (
                    <div
                      key={i}
                      className={l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-300' : ''}
                    >
                      {new Date(l.ts).toLocaleTimeString()} · {l.message}
                    </div>
                  ))
                )}
              </div>

              {feedback && <p className={`mt-2 text-xs ${fbColor}`}>{feedback.text}</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-700 p-4">
          <button
            type="button"
            onClick={testConnection}
            disabled={testing || !loaded}
            className="mr-auto rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-40"
          >
            {testing ? 'Probando…' : 'Probar conexión'}
          </button>
          <button
            type="button"
            onClick={pollNow}
            disabled={polling || !loaded}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-40"
          >
            {polling ? 'Buscando…' : 'Buscar ahora'}
          </button>
          {onPublishCatalog && (
            <button
              type="button"
              onClick={publishCatalog}
              disabled={publishing || !loaded}
              title="Publica todas las planchas oficiales al catálogo (Supabase)"
              className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-40"
            >
              {publishing ? 'Publicando…' : 'Publicar catálogo'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !loaded}
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
