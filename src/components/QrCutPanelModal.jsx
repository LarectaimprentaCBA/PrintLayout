import { useEffect, useRef, useState } from 'react';

// Panel "Servidor de corte QR": esta PC hace de servidor para el corte por QR
// del plotter (reemplaza al QRFileCut.exe). Muestra el estado de conexión en
// vivo, deja editar la IP del plotter y la carpeta de los .plt, y permite forzar
// una reconexión. La config persiste entre reinicios (a diferencia del programa
// viejo, que había que reconfigurar cada día).

const EMPTY = {
  plotterIP: '192.168.100.250', plotterPort: 8080,
  cortesDir: '', activo: true,
};

export default function QrCutPanelModal({ open, onClose }) {
  const [cfg, setCfg] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [feedback, setFeedback] = useState(null); // { kind, text }
  const [status, setStatus] = useState(null); // { connected, activo, lastServed, ... }
  const [logs, setLogs] = useState([]);
  const logBoxRef = useRef(null);

  const api = typeof window !== 'undefined' ? window.printlayout?.qrcut : null;

  // Cargar config + estado al abrir.
  useEffect(() => {
    if (!open || !api) return;
    setLoaded(false);
    setFeedback(null);
    api.getConfig().then((c) => {
      setCfg({ ...EMPTY, ...(c || {}) });
      setLoaded(true);
    });
    api.getStatus().then((s) => setStatus(s || null));
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
      const r = await api.setConfig({
        ...cfg,
        plotterPort: Number(cfg.plotterPort) || 8080,
      });
      if (r?.ok) {
        setCfg({ ...EMPTY, ...r.config });
        setFeedback({ kind: 'ok', text: 'Guardado. Reconectando con los nuevos datos…' });
      } else {
        setFeedback({ kind: 'err', text: r?.error || 'No se pudo guardar.' });
      }
    } finally {
      setSaving(false);
    }
  };

  const chooseDir = async () => {
    const r = await api.chooseDir?.();
    if (r?.ok && r.path) patch({ cortesDir: r.path });
  };

  const reconnect = async () => {
    setReconnecting(true);
    setFeedback(null);
    try {
      const r = await api.reconnect();
      setFeedback(
        r?.ok
          ? { kind: 'ok', text: 'Reconectando…' }
          : { kind: 'err', text: r?.error || 'No se pudo reconectar.' },
      );
    } finally {
      setReconnecting(false);
    }
  };

  const fbColor = feedback?.kind === 'ok'
    ? 'text-green-300'
    : feedback?.kind === 'err'
      ? 'text-red-300'
      : 'text-ink-300';

  const connected = !!status?.connected;
  const activo = status?.activo ?? cfg.activo;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-[40rem] max-w-[95vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="border-b border-ink-700 p-4">
          <h3 className="text-sm font-semibold text-ink-100">Servidor de corte QR</h3>
          <p className="mt-1 text-xs text-ink-400">
            Esta PC atiende el corte por QR del plotter. El operario deja el .plt en
            la carpeta, escanea el QR y la máquina pide el corte acá. Se conecta
            solo al abrir PrintLayout y no toca la cuchilla al conectarse.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!loaded ? (
            <p className="text-xs text-ink-400">Cargando…</p>
          ) : (
            <>
              {/* Estado en vivo */}
              <div className="mb-3 flex items-center gap-3 rounded border border-ink-700 bg-ink-950/40 px-3 py-2 text-sm">
                {!activo ? (
                  <span className="font-medium text-ink-500">⚪ Servidor apagado</span>
                ) : connected ? (
                  <span className="font-medium text-green-400">🟢 Conectado al plotter</span>
                ) : (
                  <span className="font-medium text-red-400">🔴 Desconectado</span>
                )}
                {status?.paused && <span className="text-[11px] text-amber-300">(pausado por envío directo)</span>}
                {status?.lastServed && (
                  <span className="ml-auto text-[11px] text-ink-400">
                    Último corte: <b className="text-ink-200">{status.lastServed.name}</b>{' '}
                    · {new Date(status.lastServed.ts).toLocaleTimeString()}
                  </span>
                )}
              </div>

              <label className="mb-3 flex cursor-pointer items-center gap-2 rounded border border-ink-700 bg-ink-950/40 px-3 py-2 text-xs text-ink-200">
                <input
                  type="checkbox"
                  checked={!!cfg.activo}
                  onChange={(e) => patch({ activo: e.target.checked })}
                  className="h-4 w-4 accent-accent-500"
                />
                <span>
                  <span className="font-medium text-ink-100">Servidor de corte QR activo</span>
                  <span className="block text-[11px] text-ink-400">
                    Tildado en la PC conectada al plotter. En las demás PCs dejalo destildado.
                  </span>
                </span>
              </label>

              <div className="grid grid-cols-3 gap-2">
                <label className="col-span-2 block text-xs text-ink-300">
                  <span className="mb-1 block">IP del plotter</span>
                  <input
                    value={cfg.plotterIP}
                    onChange={(e) => patch({ plotterIP: e.target.value })}
                    placeholder="192.168.100.250"
                    className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
                <label className="block text-xs text-ink-300">
                  <span className="mb-1 block">Puerto</span>
                  <input
                    value={cfg.plotterPort}
                    onChange={(e) => patch({ plotterPort: e.target.value })}
                    placeholder="8080"
                    className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
              </div>
              <p className="mt-1 text-[10px] text-ink-500">
                Esta misma IP la usa también el envío directo de cortes desde PrintLayout.
              </p>

              <label className="mt-3 block text-xs text-ink-300">
                <span className="mb-1 block">Carpeta de cortes (.plt)</span>
                <div className="flex gap-2">
                  <input
                    value={cfg.cortesDir}
                    onChange={(e) => patch({ cortesDir: e.target.value })}
                    placeholder="C:\Users\...\Cortes QR  (acepta ruta de red \\SERVIDOR\Cortes)"
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
                <span className="mt-1 block text-[10px] text-ink-500">
                  El QR trae el nombre del archivo; se sirve <b>&lt;nombre&gt;.plt</b> desde esta carpeta.
                </span>
              </label>

              {/* Log */}
              <div
                ref={logBoxRef}
                className="mt-4 h-32 overflow-y-auto rounded border border-ink-800 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-ink-400"
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
            onClick={reconnect}
            disabled={reconnecting || !loaded}
            className="mr-auto rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-40"
          >
            {reconnecting ? 'Reconectando…' : 'Reconectar'}
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
