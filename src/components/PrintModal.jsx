// Modal propio de impresion. Reemplaza el dialogo nativo de Windows porque
// Chromium/Electron al abrir Preferencias de impresion persiste lo que el
// usuario toque como default del sistema (afecta todas las apps). Aca el
// usuario solo elige impresora y copias; para configurar el driver hay un
// boton aparte "Configurar impresora" que invoca rundll32 printui.dll.
import { useEffect, useMemo, useState } from 'react';

const LS_LAST_PRINTER = 'printlayout.lastPrinter';
const LS_LAST_COPIES = 'printlayout.lastCopies';

export default function PrintModal({
  open,
  faceLabel,
  onConfirm,
  onCancel,
}) {
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deviceName, setDeviceName] = useState('');
  const [copies, setCopies] = useState(1);
  const [openingConfig, setOpeningConfig] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const r = await window.printlayout.pdf.listPrinters();
        if (cancelled) return;
        if (!r?.ok) {
          setError(r?.error ?? 'No se pudo listar impresoras.');
          setPrinters([]);
          return;
        }
        const list = r.printers ?? [];
        setPrinters(list);
        const last = localStorage.getItem(LS_LAST_PRINTER);
        const lastCopies = parseInt(localStorage.getItem(LS_LAST_COPIES) ?? '1', 10);
        const lastExists = last && list.some((p) => p.name === last);
        const def = lastExists
          ? last
          : list.find((p) => p.isDefault)?.name ?? list[0]?.name ?? '';
        setDeviceName(def);
        setCopies(Number.isFinite(lastCopies) && lastCopies > 0 ? lastCopies : 1);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const canPrint = useMemo(
    () => !loading && !error && !!deviceName && copies >= 1 && copies <= 999,
    [loading, error, deviceName, copies],
  );

  const handleConfirm = () => {
    if (!canPrint) return;
    try {
      localStorage.setItem(LS_LAST_PRINTER, deviceName);
      localStorage.setItem(LS_LAST_COPIES, String(copies));
    } catch {}
    onConfirm?.({ deviceName, copies });
  };

  const handleOpenConfig = async () => {
    if (!deviceName || openingConfig) return;
    setOpeningConfig(true);
    try {
      await window.printlayout.pdf.openPrinterConfig(deviceName);
    } catch (err) {
      setError(err.message);
    } finally {
      setOpeningConfig(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div className="w-[420px] rounded-lg border border-ink-700 bg-ink-900 p-4 shadow-2xl">
        <h3 className="text-sm font-semibold text-ink-100">
          Imprimir{faceLabel ? ` — ${faceLabel}` : ''}
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
          Las preferencias del driver (papel, calidad, color, bandeja) se
          configuran una sola vez con el botón "Configurar impresora". PrintLayout
          usa los defaults que tengas guardados en Windows.
        </p>

        {error && (
          <div className="mt-3 rounded border border-red-900 bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-3 text-xs text-ink-200">
          <label className="block">
            <span className="mb-1 block text-ink-400">Impresora</span>
            <div className="flex gap-2">
              <select
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                disabled={loading || printers.length === 0}
                className="flex-1 rounded border border-ink-700 bg-ink-950 px-2 py-1 text-ink-100 disabled:opacity-40"
              >
                {loading && <option>Cargando…</option>}
                {!loading && printers.length === 0 && (
                  <option>(sin impresoras)</option>
                )}
                {!loading &&
                  printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.displayName || p.name}
                      {p.isDefault ? ' (predeterminada)' : ''}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={handleOpenConfig}
                disabled={!deviceName || openingConfig}
                title="Abre las Preferencias del driver de Windows. Lo que cambies acá queda como predeterminado para esa impresora."
                className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
              >
                Configurar impresora
              </button>
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-ink-400">Copias</span>
            <input
              type="number"
              min={1}
              max={999}
              value={copies}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setCopies(Number.isFinite(v) && v > 0 ? Math.min(v, 999) : 1);
              }}
              onFocus={(e) => e.target.select()}
              className="w-24 rounded border border-ink-700 bg-ink-950 px-2 py-1 text-ink-100"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onCancel?.()}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canPrint}
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            Imprimir
          </button>
        </div>
      </div>
    </div>
  );
}
