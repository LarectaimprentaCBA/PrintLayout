// Modal propio de impresion. El usuario elige impresora + copias; el helper
// nativo (PrintHelper.exe) imprime silent (SHOW_DIALOG=0) usando los defaults
// del driver para esa impresora. Para configurar paper/calidad/duplex/etc.
// hay un boton aparte "Configurar impresora" que abre Preferencias del
// driver via rundll32 printui.dll — esos cambios SI quedan como default del
// sistema para esa impresora (es lo que el usuario quiere — configurar una
// sola vez por impresora).
import { useEffect, useMemo, useState } from 'react';

const LS_LAST_PRINTER = 'printlayout.lastPrinter';

// Parsea una lista tipo "1-3,5,7-9" a indices 0-based, validados contra
// totalPages. Devuelve null si hay error de sintaxis o algun rango sale de
// [1..totalPages].
function parseRange(text, totalPages) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t) return null;
  const result = new Set();
  const parts = t.split(',');
  for (const raw of parts) {
    const seg = raw.trim();
    if (!seg) continue;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(seg);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      if (a > b) [a, b] = [b, a];
      if (a < 1 || b > totalPages) return null;
      for (let i = a; i <= b; i++) result.add(i - 1);
    } else if (/^\d+$/.test(seg)) {
      const n = parseInt(seg, 10);
      if (n < 1 || n > totalPages) return null;
      result.add(n - 1);
    } else {
      return null;
    }
  }
  return [...result].sort((a, b) => a - b);
}

export default function PrintModal({
  open,
  faceLabel,
  totalPages = 1,
  currentPage = 0,
  showCutMarksOption = false,
  onConfirm,
  onCancel,
}) {
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deviceName, setDeviceName] = useState('');
  const [copies, setCopies] = useState(1);
  const [openingConfig, setOpeningConfig] = useState(false);
  const [hasCustomPrefs, setHasCustomPrefs] = useState(false);
  const [pageMode, setPageMode] = useState('all'); // 'all' | 'current' | 'range'
  const [rangeText, setRangeText] = useState('');
  // Marcas de corte: por default se imprimen (comportamiento histórico). El
  // checkbox solo se muestra cuando la plantilla tiene marcas generadas.
  const [cutMarks, setCutMarks] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCutMarks(true);
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
        const lastExists = last && list.some((p) => p.name === last);
        const def = lastExists
          ? last
          : list.find((p) => p.isDefault)?.name ?? list[0]?.name ?? '';
        setDeviceName(def);
        // Copias SIEMPRE arranca en 1 (no recordar la última): así no se imprime
        // de más por accidente. Se cambia a mano si hacen falta más.
        setCopies(1);
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

  // Cada vez que cambia la impresora seleccionada, chequear si hay
  // preferencias propias guardadas por PrintLayout para esa impresora.
  useEffect(() => {
    if (!open || !deviceName) {
      setHasCustomPrefs(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await window.printlayout.pdf.hasPrinterConfig(deviceName);
        if (!cancelled) setHasCustomPrefs(!!r?.exists);
      } catch {
        if (!cancelled) setHasCustomPrefs(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, deviceName]);

  // Indices 0-based de las paginas que se van a imprimir, segun el modo.
  // null = error de parseo del rango.
  const pagesToPrint = useMemo(() => {
    if (pageMode === 'all') {
      return Array.from({ length: totalPages }, (_, i) => i);
    }
    if (pageMode === 'current') {
      return [Math.max(0, Math.min(totalPages - 1, currentPage))];
    }
    return parseRange(rangeText, totalPages);
  }, [pageMode, rangeText, totalPages, currentPage]);

  const rangeInvalid = pageMode === 'range' && pagesToPrint === null;

  const canPrint = useMemo(
    () =>
      !loading &&
      !error &&
      !!deviceName &&
      copies >= 1 &&
      copies <= 999 &&
      Array.isArray(pagesToPrint) &&
      pagesToPrint.length > 0,
    [loading, error, deviceName, copies, pagesToPrint],
  );

  const handleConfirm = () => {
    if (!canPrint) return;
    try {
      localStorage.setItem(LS_LAST_PRINTER, deviceName);
    } catch {}
    onConfirm?.({
      deviceName,
      copies,
      pages: pagesToPrint,
      // Si la plantilla no ofrece la opción, mandamos true (no cambia nada).
      cutMarks: showCutMarksOption ? cutMarks : true,
    });
  };

  const handleOpenConfig = async () => {
    if (!deviceName || openingConfig) return;
    setOpeningConfig(true);
    setError(null);
    try {
      const r = await window.printlayout.pdf.openPrinterConfig(deviceName);
      if (r?.configured) {
        setHasCustomPrefs(true);
      } else if (r?.canceled) {
        // Cancelo el dialog — no hacemos nada.
      } else if (!r?.ok) {
        setError(r?.error ?? 'No se pudo abrir la configuración.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setOpeningConfig(false);
    }
  };

  const handleResetConfig = async () => {
    if (!deviceName) return;
    try {
      const r = await window.printlayout.pdf.resetPrinterConfig(deviceName);
      if (r?.ok) setHasCustomPrefs(false);
    } catch (err) {
      setError(err.message);
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
          "Configurar impresora" guarda papel/calidad/color/bandeja/etc. solo
          para PrintLayout — no toca los predeterminados de Windows ni los de
          otras apps.
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
                title="Abre Preferencias del driver sobre una copia en memoria. Lo que elijas se guarda solo para PrintLayout."
                className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
              >
                {openingConfig ? 'Configurando…' : 'Configurar impresora'}
              </button>
            </div>
            {hasCustomPrefs && (
              <div className="mt-1.5 flex items-center justify-between rounded border border-accent-500/30 bg-accent-500/5 px-2 py-1 text-[11px] text-accent-300">
                <span>Preferencias propias guardadas para esta impresora.</span>
                <button
                  type="button"
                  onClick={handleResetConfig}
                  title="Volver a usar los predeterminados de Windows para esta impresora."
                  className="rounded border border-ink-700 px-1.5 py-0.5 text-[10px] text-ink-300 hover:bg-ink-800"
                >
                  Resetear
                </button>
              </div>
            )}
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

          {totalPages > 1 && (
            <div className="block">
              <span className="mb-1 block text-ink-400">Páginas</span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="pageMode"
                    value="all"
                    checked={pageMode === 'all'}
                    onChange={() => setPageMode('all')}
                    className="accent-accent-600"
                  />
                  <span>Todas ({totalPages})</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="pageMode"
                    value="current"
                    checked={pageMode === 'current'}
                    onChange={() => setPageMode('current')}
                    className="accent-accent-600"
                  />
                  <span>Actual ({currentPage + 1})</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="pageMode"
                    value="range"
                    checked={pageMode === 'range'}
                    onChange={() => setPageMode('range')}
                    className="accent-accent-600"
                  />
                  <span>Rango</span>
                </label>
                {pageMode === 'range' && (
                  <input
                    type="text"
                    value={rangeText}
                    onChange={(e) => setRangeText(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    placeholder="ej: 1-3,5"
                    className={`flex-1 min-w-[120px] rounded border bg-ink-950 px-2 py-1 text-ink-100 ${
                      rangeInvalid ? 'border-red-500' : 'border-ink-700'
                    }`}
                  />
                )}
              </div>
              {pageMode === 'range' && rangeInvalid && (
                <p className="mt-1 text-[10px] text-red-400">
                  Rango inválido. Usá números entre 1 y {totalPages}, ej: "1-3,5".
                </p>
              )}
            </div>
          )}

          {showCutMarksOption && (
            <label className="flex cursor-pointer items-start gap-2 rounded border border-ink-700 bg-ink-950/40 px-2 py-1.5">
              <input
                type="checkbox"
                checked={cutMarks}
                onChange={(e) => setCutMarks(e.target.checked)}
                className="mt-0.5 accent-accent-600"
              />
              <span>
                <span className="block text-ink-200">Imprimir marcas de corte</span>
                <span className="block text-[10px] leading-snug text-ink-500">
                  Las marcas en L de las esquinas que usa el plotter para
                  alinear. Destildá si solo vas a posar las fotos sin cortar.
                </span>
              </span>
            </label>
          )}
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
