import { useEffect, useRef, useState } from 'react';

// Panel "Pedidos de fotos": configura la conexión a Supabase y controla el
// servicio de entrada automática. Muestra estado en vivo + log, y permite
// "Probar conexión" y "Buscar ahora". El servicio sólo ARMA y deja la hoja
// abierta para revisar (nunca imprime/corta solo).

const EMPTY = { supabaseUrl: '', serviceKey: '', pollSeconds: 60, outputDir: '', activo: false };

export default function IntakePanelModal({ open, onClose }) {
  const [cfg, setCfg] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [feedback, setFeedback] = useState(null); // { kind, text }
  const [status, setStatus] = useState(null); // { activo, busy, pollSeconds, lastRun }
  const [logs, setLogs] = useState([]);
  const logBoxRef = useRef(null);

  const api = typeof window !== 'undefined' ? window.printlayout?.intake : null;

  // Cargar config al abrir.
  useEffect(() => {
    if (!open || !api) return;
    setLoaded(false);
    setFeedback(null);
    api.getConfig().then((c) => {
      setCfg({ ...EMPTY, ...(c || {}) });
      setStatus({ activo: !!c?.activo, pollSeconds: c?.pollSeconds ?? 60, busy: false });
      setLoaded(true);
    });
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

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const r = await api.setConfig(cfg);
      if (r?.ok) {
        setCfg({ ...EMPTY, ...r.config });
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

  const testConnection = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      // Guardamos primero para probar con lo que está en pantalla.
      await api.setConfig(cfg);
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
      await api.setConfig(cfg);
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
