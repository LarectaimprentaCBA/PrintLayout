import { useEffect, useMemo, useRef, useState } from 'react';
import { computeBestGrid, PAPER_PRESETS } from '../lib/grid.js';

function parseNum(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export default function GridUploadModal({ open, onConfirm, onCancel }) {
  const [paperId, setPaperId] = useState('a4');
  const [paperW, setPaperW] = useState('210');
  const [paperH, setPaperH] = useState('297');
  const [cellW, setCellW] = useState('70');
  const [cellH, setCellH] = useState('50');
  const [margin, setMargin] = useState('0');
  const [spacingX, setSpacingX] = useState('0');
  const [spacingY, setSpacingY] = useState('0');
  const cellWRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => cellWRef.current?.select(), 0);
    }
  }, [open]);

  // Cuando elegis un preset, sincroniza paperW/H. "custom" no toca.
  useEffect(() => {
    const preset = PAPER_PRESETS.find((p) => p.id === paperId);
    if (preset) {
      setPaperW(String(preset.w));
      setPaperH(String(preset.h));
    }
  }, [paperId]);

  const params = useMemo(() => ({
    paperW: parseNum(paperW),
    paperH: parseNum(paperH),
    cellW: parseNum(cellW),
    cellH: parseNum(cellH),
    marginX: parseNum(margin) || 0,
    marginY: parseNum(margin) || 0,
    spacingX: parseNum(spacingX) || 0,
    spacingY: parseNum(spacingY) || 0,
  }), [paperW, paperH, cellW, cellH, margin, spacingX, spacingY]);

  const valid = (
    params.paperW > 0 && params.paperH > 0
    && params.cellW > 0 && params.cellH > 0
  );

  const result = useMemo(() => (valid ? computeBestGrid(params) : null), [params, valid]);

  const cellOrientationUsed = useMemo(() => {
    if (!result || result.cells.length === 0) return null;
    const c = result.cells[0];
    if (Math.abs(c.w - params.cellW) < 0.01 && Math.abs(c.h - params.cellH) < 0.01) return 'directa';
    return 'rotada 90°';
  }, [result, params]);

  if (!open) return null;

  const submit = (e) => {
    e?.preventDefault();
    if (!valid || !result || result.cells.length === 0) return;
    onConfirm?.({
      paperWidthMm: params.paperW,
      paperHeightMm: params.paperH,
      cells: result.cells,
      cols: result.cols,
      rows: result.rows,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <form
        onSubmit={submit}
        className="w-[28rem] rounded-lg border border-ink-700 bg-ink-900 p-4 shadow-2xl"
      >
        <h3 className="text-sm font-semibold text-ink-100">Nueva grilla rápida</h3>
        <p className="mt-1 text-xs text-ink-400">
          Hoja en blanco con celdas uniformes. No se guarda como plantilla — al cerrar la app se descarta.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block text-xs text-ink-300">
            <span className="block mb-1">Tamaño de hoja</span>
            <select
              value={paperId}
              onChange={(e) => setPaperId(e.target.value)}
              className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
            >
              {PAPER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
              <option value="custom">Custom (mm)</option>
            </select>
          </label>

          {paperId === 'custom' && (
            <div className="grid grid-cols-2 gap-2 text-xs text-ink-300">
              <label>
                <span className="block mb-1">Ancho hoja (mm)</span>
                <input
                  value={paperW}
                  onChange={(e) => setPaperW(e.target.value)}
                  className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                />
              </label>
              <label>
                <span className="block mb-1">Alto hoja (mm)</span>
                <input
                  value={paperH}
                  onChange={(e) => setPaperH(e.target.value)}
                  className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                />
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs text-ink-300">
            <label>
              <span className="block mb-1">Ancho celda (mm)</span>
              <input
                ref={cellWRef}
                value={cellW}
                onChange={(e) => setCellW(e.target.value)}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              />
            </label>
            <label>
              <span className="block mb-1">Alto celda (mm)</span>
              <input
                value={cellH}
                onChange={(e) => setCellH(e.target.value)}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs text-ink-300">
            <label>
              <span className="block mb-1">Margen (mm)</span>
              <input
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              />
            </label>
            <label>
              <span className="block mb-1">Sep. horiz. (mm)</span>
              <input
                value={spacingX}
                onChange={(e) => setSpacingX(e.target.value)}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              />
            </label>
            <label>
              <span className="block mb-1">Sep. vert. (mm)</span>
              <input
                value={spacingY}
                onChange={(e) => setSpacingY(e.target.value)}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              />
            </label>
          </div>
        </div>

        <div className="mt-4 rounded border border-ink-700 bg-ink-800 p-3 text-xs">
          {result && result.cells.length > 0 ? (
            <p className="text-ink-200">
              <span className="font-semibold text-accent-400">{result.cells.length}</span>{' '}
              celdas por hoja{' '}
              <span className="text-ink-400">
                ({result.cols} × {result.rows}, celda {cellOrientationUsed})
              </span>
            </p>
          ) : (
            <p className="text-red-300">
              No entra ninguna celda con esos valores. Reducí el tamaño de celda o el margen.
            </p>
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
            type="submit"
            disabled={!result || result.cells.length === 0}
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            Crear grilla
          </button>
        </div>
      </form>
    </div>
  );
}
