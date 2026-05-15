import { useEffect, useMemo, useRef, useState } from 'react';
import { PAPER_PRESETS } from '../lib/grid.js';
import { packImagesByCount } from '../lib/imagePacking.js';

function parseNum(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const ASPECT_OPTIONS = [
  { id: 'auto', label: 'Auto', ratio: null },
  { id: 'vertical', label: 'Vertical', ratio: 3 / 4 },
  { id: 'horizontal', label: 'Horizontal', ratio: 4 / 3 },
  { id: 'cuadrada', label: 'Cuadrada', ratio: 1 },
];

export default function ImageCountPackModal({ open, files = [], onConfirm, onCancel }) {
  const [count, setCount] = useState('6');
  const [paperId, setPaperId] = useState('a4');
  const [paperW, setPaperW] = useState('210');
  const [paperH, setPaperH] = useState('297');
  const [margin, setMargin] = useState('5');
  const [spacingX, setSpacingX] = useState('2');
  const [spacingY, setSpacingY] = useState('2');
  const [aspectMode, setAspectMode] = useState('auto');
  const [imageDims, setImageDims] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setImageDims(null);
    setTimeout(() => inputRef.current?.select(), 0);
    let cancelled = false;
    const urls = files.map((f) => URL.createObjectURL(f));
    const promises = urls.map(
      (url) =>
        new Promise((resolve) => {
          const im = new Image();
          im.onload = () => resolve({
            naturalWidth: im.naturalWidth,
            naturalHeight: im.naturalHeight,
          });
          im.onerror = () => resolve({ naturalWidth: 0, naturalHeight: 0 });
          im.src = url;
        }),
    );
    Promise.all(promises).then((dims) => {
      if (!cancelled) setImageDims(dims);
      for (const url of urls) URL.revokeObjectURL(url);
    });
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [open, files]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

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
    count: parseNum(count),
    marginX: parseNum(margin) ?? 0,
    marginY: parseNum(margin) ?? 0,
    spacingX: parseNum(spacingX) ?? 0,
    spacingY: parseNum(spacingY) ?? 0,
  }), [paperW, paperH, count, margin, spacingX, spacingY]);

  const valid = (
    params.paperW > 0 && params.paperH > 0 &&
    params.count > 0 && Number.isFinite(params.count)
  );

  const cellAspect = useMemo(() => {
    const opt = ASPECT_OPTIONS.find((o) => o.id === aspectMode);
    return opt?.ratio ?? null;
  }, [aspectMode]);

  const pack = useMemo(() => {
    if (!valid || !imageDims) return null;
    return packImagesByCount({
      images: imageDims,
      count: params.count,
      paperW: params.paperW,
      paperH: params.paperH,
      marginX: params.marginX,
      marginY: params.marginY,
      spacingX: params.spacingX,
      spacingY: params.spacingY,
      cellAspect,
    });
  }, [valid, imageDims, params, cellAspect]);

  const [previewPage, setPreviewPage] = useState(0);
  useEffect(() => {
    setPreviewPage(0);
  }, [pack?.pageCount]);

  if (!open) return null;

  const submit = (e) => {
    e?.preventDefault();
    if (!pack || pack.cells.length === 0) return;
    const usedIndices = [];
    const remap = new Map();
    for (const c of pack.cells) {
      if (!remap.has(c.imageIndex)) {
        remap.set(c.imageIndex, usedIndices.length);
        usedIndices.push(c.imageIndex);
      }
    }
    const usedFiles = usedIndices.map((idx) => files[idx]);
    const flatCells = [];
    const pages = [];
    let id = 0;
    for (let p = 0; p < pack.pages.length; p++) {
      const pageCells = pack.pages[p].map((c) => ({
        id: id++, x: c.x, y: c.y, w: c.w, h: c.h,
      }));
      pages.push({ celdas: pageCells });
      flatCells.push(...pageCells);
    }
    const cellMapping = [];
    for (const page of pack.pages) {
      for (const c of page) {
        cellMapping.push(remap.get(c.imageIndex));
      }
    }
    onConfirm?.({
      paperWidthMm: params.paperW,
      paperHeightMm: params.paperH,
      pages,
      files: usedFiles,
      cellMapping,
      totalCells: pack.cells.length,
      uniqueUsed: usedFiles.length,
      totalInput: pack.total,
      pageCount: pack.pageCount,
      countPerPage: params.count,
      grid: pack.grid,
    });
  };

  const previewMaxPx = 280;
  const previewScale = pack
    ? Math.min(previewMaxPx / params.paperW, previewMaxPx / params.paperH)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="flex max-h-[90vh] w-[44rem] max-w-[95vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl"
      >
        <div className="border-b border-ink-700 p-4">
          <h3 className="text-sm font-semibold text-ink-100">Acomodar por cantidad</h3>
          <p className="mt-1 text-xs text-ink-400">
            Indicás cuántas imágenes querés por hoja y el sistema calcula la
            grilla óptima al máximo tamaño posible. Las imágenes mantienen su
            proporción dentro de cada celda.
          </p>
        </div>

        <div className="flex flex-1 gap-4 overflow-y-auto p-4">
          <div className="w-[20rem] shrink-0 space-y-3">
            <label className="block text-xs text-ink-300">
              <span className="block mb-1">Cantidad por hoja</span>
              <input
                ref={inputRef}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              />
            </label>

            <div>
              <span className="block mb-1 text-xs text-ink-300">Forma de la celda</span>
              <div className="grid grid-cols-4 gap-1 rounded border border-ink-700 bg-ink-800 p-0.5">
                {ASPECT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAspectMode(opt.id)}
                    className={`rounded px-1 py-1 text-xs ${
                      aspectMode === opt.id
                        ? 'bg-accent-600 text-white'
                        : 'text-ink-300 hover:text-ink-100'
                    }`}
                    title={opt.id === 'auto' ? 'Promedio de las imágenes cargadas' : opt.label}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

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
                  <span className="block mb-1">Ancho hoja</span>
                  <input
                    value={paperW}
                    onChange={(e) => setPaperW(e.target.value)}
                    className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
                <label>
                  <span className="block mb-1">Alto hoja</span>
                  <input
                    value={paperH}
                    onChange={(e) => setPaperH(e.target.value)}
                    className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
              </div>
            )}

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
                <span className="block mb-1">Sep. horiz.</span>
                <input
                  value={spacingX}
                  onChange={(e) => setSpacingX(e.target.value)}
                  className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                />
              </label>
              <label>
                <span className="block mb-1">Sep. vert.</span>
                <input
                  value={spacingY}
                  onChange={(e) => setSpacingY(e.target.value)}
                  className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                />
              </label>
            </div>

            <div className="rounded border border-ink-700 bg-ink-800 p-2.5 text-xs">
              {imageDims === null ? (
                <p className="text-ink-400">Leyendo dimensiones de las imágenes…</p>
              ) : !pack ? (
                <p className="text-red-300">Parámetros inválidos.</p>
              ) : pack.cells.length === 0 ? (
                <p className="text-red-300">
                  No se pudo calcular una grilla con esos parámetros. Probá
                  reducir la cantidad, los márgenes o cambiar la hoja.
                </p>
              ) : (
                <>
                  <p className="text-ink-200">
                    Grilla{' '}
                    <span className="font-semibold text-accent-400">
                      {pack.grid.rows}×{pack.grid.cols}
                    </span>
                    {' '}— celda{' '}
                    <span className="font-semibold text-accent-400">
                      {pack.grid.cellW.toFixed(1)}×{pack.grid.cellH.toFixed(1)} mm
                    </span>
                  </p>
                  <p className="mt-1 text-ink-300">
                    {pack.uniqueUsed} imagen{pack.uniqueUsed === 1 ? '' : 'es'} en{' '}
                    <span className="font-semibold text-accent-400">
                      {pack.pageCount} hoja{pack.pageCount === 1 ? '' : 's'}
                    </span>
                    {' '}({pack.cells.length} celdas en total)
                  </p>
                  {pack.uniqueUsed < params.count && pack.pageCount === 1 && (
                    <p className="mt-1 text-ink-400">
                      Las {pack.uniqueUsed} imagen{pack.uniqueUsed === 1 ? '' : 'es'} se
                      repite{pack.uniqueUsed === 1 ? '' : 'n'} para llenar las {params.count} celdas.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex flex-1 flex-col items-center justify-start gap-2">
            {pack && pack.placed > 0 && (
              <>
                <div
                  className="relative border border-ink-600 bg-ink-100"
                  style={{
                    width: params.paperW * previewScale,
                    height: params.paperH * previewScale,
                  }}
                >
                  {(pack.pages[Math.min(previewPage, pack.pages.length - 1)] || []).map((c, i) => (
                    <div
                      key={i}
                      className="absolute border border-accent-500/70 bg-accent-500/20"
                      style={{
                        left: c.x * previewScale,
                        top: c.y * previewScale,
                        width: c.w * previewScale,
                        height: c.h * previewScale,
                      }}
                      title={`${c.w.toFixed(1)}×${c.h.toFixed(1)} mm`}
                    />
                  ))}
                </div>
                {pack.pageCount > 1 && (
                  <div className="flex items-center gap-2 text-xs text-ink-300">
                    <button
                      type="button"
                      disabled={previewPage <= 0}
                      onClick={() => setPreviewPage((p) => Math.max(0, p - 1))}
                      className="rounded border border-ink-700 px-2 py-0.5 hover:bg-ink-800 disabled:opacity-30"
                    >
                      ‹
                    </button>
                    <span>
                      Hoja {Math.min(previewPage, pack.pageCount - 1) + 1} de {pack.pageCount}
                    </span>
                    <button
                      type="button"
                      disabled={previewPage >= pack.pageCount - 1}
                      onClick={() => setPreviewPage((p) => Math.min(pack.pageCount - 1, p + 1))}
                      className="rounded border border-ink-700 px-2 py-0.5 hover:bg-ink-800 disabled:opacity-30"
                    >
                      ›
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-700 p-4">
          <span className="mr-auto text-xs text-ink-400">
            {files.length} archivo{files.length === 1 ? '' : 's'} seleccionado{files.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={() => onCancel?.()}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!pack || pack.placed === 0}
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            Crear plantilla
          </button>
        </div>
      </form>
    </div>
  );
}
