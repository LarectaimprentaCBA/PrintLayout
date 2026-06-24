import { useMemo, useState } from 'react';
import { computeGrid } from '../lib/grid.js';

// Modal del modo Stickers: elegir hoja, tamaño de cada sticker (caja contenedora),
// separación entre stickers, tolerancia del quita-fondo y sangrado del corte.
// El armado pesado (trazar contornos, ubicar) lo hace App.submitStickers.
export default function StickerSizeModal({ open, fileCount = 0, onConfirm, onCancel }) {
  const [paperW, setPaperW] = useState(210);
  const [paperH, setPaperH] = useState(297);
  const [cellW, setCellW] = useState(50);
  const [cellH, setCellH] = useState(50);
  const [spacing, setSpacing] = useState(4);
  const [tolerance, setTolerance] = useState(32);
  const [bleed, setBleed] = useState(0);

  const margin = 10; // margen de hoja = lugar para las marcas L (markMargin)

  const { cols, rows, fit } = useMemo(() => {
    if (!cellW || !cellH) return { cols: 0, rows: 0, fit: 0 };
    const g = computeGrid({
      paperW, paperH, cellW, cellH,
      marginX: margin, marginY: margin,
      spacingX: spacing, spacingY: spacing,
    });
    return { cols: g.cols, rows: g.rows, fit: g.cells.length };
  }, [paperW, paperH, cellW, cellH, spacing]);

  if (!open) return null;

  const placed = Math.min(fit, fileCount);
  const overflow = Math.max(0, fileCount - fit);

  const submit = () => {
    onConfirm?.({
      paperWidthMm: paperW,
      paperHeightMm: paperH,
      cellW, cellH,
      spacingMm: spacing,
      marginMm: margin,
      tolerance,
      bleedMm: bleed,
    });
  };

  const setPaper = (w, h) => { setPaperW(w); setPaperH(h); };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
    >
      <div className="flex w-[460px] max-w-[95vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-ink-100">Stickers · tamaño y corte</h3>
          <button type="button" onClick={onCancel} className="text-ink-400 hover:text-ink-100" title="Cerrar">✕</button>
        </div>

        <div className="space-y-4 p-4">
          <div className="text-xs text-ink-400">{fileCount} imagen{fileCount === 1 ? '' : 'es'} cargada{fileCount === 1 ? '' : 's'}.</div>

          <Section title="Hoja">
            <div className="flex items-center gap-2">
              <NumField label="Ancho" value={paperW} onChange={setPaperW} />
              <NumField label="Alto" value={paperH} onChange={setPaperH} />
              <div className="flex gap-1 self-end pb-0.5">
                <Chip active={paperW === 210 && paperH === 297} onClick={() => setPaper(210, 297)}>A4</Chip>
                <Chip active={paperW === 297 && paperH === 420} onClick={() => setPaper(297, 420)}>A3</Chip>
              </div>
            </div>
          </Section>

          <Section title="Tamaño de cada sticker (caja máxima, mm)">
            <div className="flex items-center gap-2">
              <NumField label="Ancho" value={cellW} onChange={setCellW} />
              <NumField label="Alto" value={cellH} onChange={setCellH} />
              <NumField label="Separación" value={spacing} onChange={setSpacing} />
            </div>
            <p className="mt-1 text-[11px] text-ink-500">
              Cada diseño entra en esa caja conservando su proporción. La separación deja lugar para el contorno + cuchilla.
            </p>
          </Section>

          <Section title="Contorno">
            <div className="flex items-center gap-4">
              <label className="flex-1 text-xs text-ink-300">
                <div className="flex items-center justify-between">
                  <span>Tolerancia fondo</span>
                  <span className="font-mono text-ink-400">{tolerance}</span>
                </div>
                <input type="range" min={0} max={128} step={1} value={tolerance}
                  onChange={(e) => setTolerance(Number(e.target.value))}
                  className="w-full accent-accent-500" />
              </label>
              <NumField label="Sangrado mm" value={bleed} onChange={setBleed} step={0.1} />
            </div>
            <p className="mt-1 text-[11px] text-ink-500">
              Tolerancia alta = saca más tonos parecidos al fondo. Sangrado &gt; 0 = corta un poco por fuera del diseño.
            </p>
          </Section>

          <div className={`rounded-md border px-3 py-2 text-xs ${
            overflow > 0 ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-ink-700 bg-ink-800/50 text-ink-300'
          }`}>
            Entran <b>{cols}×{rows} = {fit}</b> por hoja · se colocan <b>{placed}</b>
            {overflow > 0 && <> · <b>{overflow}</b> no entran (por ahora 1 hoja)</>}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-700 px-4 py-3">
          <button type="button" onClick={onCancel}
            className="rounded border border-ink-700 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800">
            Cancelar
          </button>
          <button type="button" onClick={submit} disabled={placed === 0}
            className="rounded bg-accent-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40">
            Armar hoja
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{title}</div>
      {children}
    </div>
  );
}

function NumField({ label, value, onChange, step = 1 }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-ink-300">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
      />
    </label>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded border px-2 py-1 text-[11px] ${
        active ? 'border-accent-500 bg-accent-600/20 text-accent-200' : 'border-ink-700 text-ink-300 hover:bg-ink-800'
      }`}>
      {children}
    </button>
  );
}
