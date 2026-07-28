import { useEffect, useMemo, useState } from 'react';
import { sheetScaleInfo } from '../lib/templateResize.js';

// Adaptar una plantilla a otra hoja física (cuando el proveedor cambia el tamaño
// de la hoja). Crea una COPIA adaptada; la original queda como respaldo.
export default function AdaptSheetModal({ open, template, onClose, onSubmit }) {
  const curW = template ? Math.round(template.pageWidthMm * 100) / 100 : 0;
  const curH = template ? Math.round(template.pageHeightMm * 100) / 100 : 0;
  const [w, setW] = useState('');
  const [h, setH] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && template) {
      setW(String(curW));
      setH(String(curH));
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id]);

  const nw = parseFloat(String(w).replace(',', '.'));
  const nh = parseFloat(String(h).replace(',', '.'));
  const valid = Number.isFinite(nw) && Number.isFinite(nh) && nw > 0 && nh > 0;
  const changed = valid && (Math.abs(nw - curW) > 0.01 || Math.abs(nh - curH) > 0.01);

  const info = useMemo(
    () => (valid && template ? sheetScaleInfo(template, nw, nh) : null),
    [valid, template, nw, nh],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !template) return null;

  const fmtPct = (p) => `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;

  const submit = async () => {
    if (!valid || !changed || busy) return;
    setBusy(true);
    try {
      await onSubmit(nw, nh);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[30rem] max-w-[95vw] rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="border-b border-ink-700 p-4">
          <h3 className="text-sm font-semibold text-ink-100">Adaptar a otra hoja</h3>
          <p className="mt-0.5 text-xs text-ink-400">
            Para cuando el proveedor te cambió el tamaño de la hoja. Encoge todo el diseño
            (bordes, QR, marcas, celdas y corte) para que entre justo en la hoja nueva.
          </p>
        </div>

        <div className="space-y-3 p-4">
          <div className="rounded border border-ink-800 bg-ink-950/40 px-3 py-2 text-[11px] text-ink-400">
            Plantilla: <span className="text-ink-200">{template.name}</span><br />
            Hoja actual: <span className="text-ink-200">{curW} × {curH} mm</span>
          </div>

          <div className="flex items-end gap-2">
            <label className="text-xs text-ink-300">
              <span className="mb-1 block">Ancho hoja nueva (mm)</span>
              <input type="number" step="0.5" value={w} onChange={(e) => setW(e.target.value)}
                className="w-28 rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500" />
            </label>
            <span className="pb-2 text-ink-500">×</span>
            <label className="text-xs text-ink-300">
              <span className="mb-1 block">Alto hoja nueva (mm)</span>
              <input type="number" step="0.5" value={h} onChange={(e) => setH(e.target.value)}
                className="w-28 rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500" />
            </label>
          </div>

          {info && changed && (
            <div className="rounded border border-ink-800 bg-ink-950/40 px-3 py-2 text-[11px] text-ink-300">
              El diseño va a quedar <span className="text-accent-300">{fmtPct(info.pctX)}</span> en el ancho
              y <span className="text-accent-300">{fmtPct(info.pctY)}</span> en el alto.
              Las tarjetas van a quedar apenas más chicas; el QR sigue leyendo.
            </div>
          )}

          <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
            Se crea una plantilla NUEVA adaptada; la original queda intacta como respaldo.
            Antes de una tirada grande, hacé <b>una hoja de prueba</b> y verificá que el corte caiga justo.
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-700 p-4">
          <button type="button" onClick={onClose}
            className="rounded border border-ink-700 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800">
            Cancelar
          </button>
          <button type="button" onClick={submit} disabled={!valid || !changed || busy}
            className="rounded bg-accent-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40">
            {busy ? 'Creando…' : 'Crear plantilla adaptada'}
          </button>
        </div>
      </div>
    </div>
  );
}
