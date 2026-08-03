import { useEffect, useMemo, useState } from 'react';
import { BUILTIN_PAPER_PRESETS } from '../lib/grid.js';
import { packMultiSizePieces } from '../lib/multiSizePacking.js';
import GridPreview from './GridPreview.jsx';

function parseNum(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Modal "Fotos con medida": subís fotos y a CADA UNA le ponés su tamaño (mm). La
// app orienta el casillero a la proporción de la foto (apaisada→acostado,
// parada→vertical), la mete ENTERA, empaqueta mezclando medidas y abre hojas
// nuevas si no entran. Las caras se detectan al cargar (readImageFiles en App),
// así "Enfocar caras" y el rellenado centrado siguen andando.
export default function PhotoSizeModal({ open, files = [], onConfirm, onCancel, presets }) {
  const paperList = useMemo(
    () => (Array.isArray(presets) && presets.length > 0 ? presets : BUILTIN_PAPER_PRESETS),
    [presets],
  );

  const [paperId, setPaperId] = useState(paperList[0]?.id || 'a4');
  const [paperW, setPaperW] = useState('210');
  const [paperH, setPaperH] = useState('297');
  const [margin, setMargin] = useState('5');
  const [spacingX, setSpacingX] = useState('2');
  const [spacingY, setSpacingY] = useState('2');
  const [items, setItems] = useState(null); // [{ url, naturalWidth, naturalHeight, w, h }]
  const [bulkW, setBulkW] = useState('100');
  const [bulkH, setBulkH] = useState('150');
  const [previewPage, setPreviewPage] = useState(0);

  // Cargar miniaturas + dimensiones de cada archivo.
  useEffect(() => {
    if (!open) { setItems(null); return undefined; }
    let cancelled = false;
    const urls = files.map((f) => URL.createObjectURL(f));
    const promises = urls.map(
      (url) => new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve({ url, naturalWidth: im.naturalWidth, naturalHeight: im.naturalHeight });
        im.onerror = () => resolve({ url, naturalWidth: 0, naturalHeight: 0 });
        im.src = url;
      }),
    );
    Promise.all(promises).then((dims) => {
      if (cancelled) { urls.forEach((u) => URL.revokeObjectURL(u)); return; }
      setItems(dims.map((d) => ({ ...d, w: '100', h: '150' })));
    });
    return () => { cancelled = true; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [open, files]);

  useEffect(() => {
    if (paperId === 'custom') return;
    const preset = paperList.find((p) => p.id === paperId);
    if (preset) { setPaperW(String(preset.w)); setPaperH(String(preset.h)); }
  }, [paperId, paperList]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const pW = parseNum(paperW);
  const pH = parseNum(paperH);
  const marginMm = Math.max(0, parseNum(margin) || 0);
  const spX = Math.max(0, parseNum(spacingX) || 0);
  const spY = Math.max(0, parseNum(spacingY) || 0);

  // Piezas: cada foto orienta su casillero a su propia proporción (la app la
  // "rota en proporción"). Las fotos NO rotan para empaquetar (quedan derechas).
  const pack = useMemo(() => {
    if (!items || !(pW > 0) || !(pH > 0)) return null;
    const pieces = [];
    items.forEach((it, i) => {
      const a = parseNum(it.w);
      const b = parseNum(it.h);
      if (!(a > 0) || !(b > 0)) return;
      const long = Math.max(a, b);
      const short = Math.min(a, b);
      const landscape = it.naturalWidth >= it.naturalHeight;
      const w = landscape ? long : short;
      const h = landscape ? short : long;
      pieces.push({ w, h, rotatable: false, ref: i });
    });
    if (pieces.length === 0) return { pages: [], pageCount: 0, placed: 0, skipped: 0, empty: true };
    const result = packMultiSizePieces({
      pieces, paperW: pW, paperH: pH,
      marginX: marginMm, marginY: marginMm, spacingX: spX, spacingY: spY,
      allowRotate: false,
    });
    let id = 0;
    const pagesWithId = result.pages.map((pageCells) =>
      pageCells.map((c) => ({ id: id++, x: c.x, y: c.y, w: c.w, h: c.h, ref: c.ref })),
    );
    return { ...result, pagesWithId };
  }, [items, pW, pH, marginMm, spX, spY]);

  useEffect(() => {
    if (pack && previewPage >= pack.pageCount) setPreviewPage(Math.max(0, pack.pageCount - 1));
  }, [pack, previewPage]);

  if (!open) return null;

  const setItem = (i, patch) =>
    setItems((its) => its.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const applyBulk = () =>
    setItems((its) => its.map((it) => ({ ...it, w: bulkW, h: bulkH })));

  const submit = (e) => {
    e?.preventDefault();
    if (!pack || !pack.placed) return;
    const pages = [];
    const cellMapping = [];
    for (const pageCells of pack.pagesWithId) {
      pages.push({ celdas: pageCells.map((c) => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h })) });
      for (const c of pageCells) cellMapping.push(c.ref);
    }
    onConfirm?.({
      paperWidthMm: pW,
      paperHeightMm: pH,
      pages,
      pageCount: pack.pageCount,
      files,
      cellMapping,
      placed: pack.placed,
      skipped: pack.skipped,
    });
  };

  const curPageCells = pack?.pagesWithId?.[Math.min(previewPage, (pack?.pageCount || 1) - 1)] || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="flex max-h-[92vh] w-[64rem] max-w-[95vw] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl"
      >
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Preview */}
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center bg-ink-950 p-4">
            <GridPreview
              paperW={pW || 0}
              paperH={pH || 0}
              cells={curPageCells}
              marginX={marginMm}
              marginY={marginMm}
              maxW={520}
              maxH={520}
            />
            <div className="mt-3 text-center text-xs">
              {pack && pack.placed > 0 ? (
                <span className="text-ink-200">
                  <span className="font-semibold text-accent-400">{pack.placed}</span> fotos en{' '}
                  <span className="font-semibold text-accent-400">{pack.pageCount}</span> hoja
                  {pack.pageCount === 1 ? '' : 's'}
                  {pack.skipped > 0 && (
                    <span className="ml-1 text-amber-400">· {pack.skipped} no entran</span>
                  )}
                </span>
              ) : (
                <span className="text-ink-400">Poné un tamaño a cada foto.</span>
              )}
            </div>
            {pack && pack.pageCount > 1 && (
              <div className="mt-2 flex items-center gap-2 text-xs text-ink-300">
                <button type="button" disabled={previewPage <= 0}
                  onClick={() => setPreviewPage((p) => Math.max(0, p - 1))}
                  className="rounded border border-ink-700 px-2 py-0.5 hover:bg-ink-800 disabled:opacity-40">‹</button>
                <span>Hoja {Math.min(previewPage, pack.pageCount - 1) + 1} de {pack.pageCount}</span>
                <button type="button" disabled={previewPage >= pack.pageCount - 1}
                  onClick={() => setPreviewPage((p) => Math.min(pack.pageCount - 1, p + 1))}
                  className="rounded border border-ink-700 px-2 py-0.5 hover:bg-ink-800 disabled:opacity-40">›</button>
              </div>
            )}
          </div>

          {/* Formulario */}
          <div className="flex w-[28rem] shrink-0 flex-col overflow-y-auto border-l border-ink-700 p-4">
            <h3 className="text-sm font-semibold text-ink-100">Fotos con medida</h3>
            <p className="mt-1 text-xs text-ink-400">
              Ponele a cada foto el tamaño que querés. Se orienta a la proporción
              de la foto y entra entera; se abren hojas nuevas si no entran.
            </p>

            <label className="mt-3 block text-xs text-ink-300">
              <span className="mb-1 block">Tamaño de hoja</span>
              <select
                value={paperId}
                onChange={(e) => setPaperId(e.target.value)}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              >
                {paperList.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
                <option value="custom">Custom (mm)</option>
              </select>
            </label>
            {paperId === 'custom' && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-ink-300">
                <label><span className="mb-1 block">Ancho hoja</span>
                  <input value={paperW} onChange={(e) => setPaperW(e.target.value)}
                    className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500" /></label>
                <label><span className="mb-1 block">Alto hoja</span>
                  <input value={paperH} onChange={(e) => setPaperH(e.target.value)}
                    className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500" /></label>
              </div>
            )}

            {/* Tamaño para todas (atajo) */}
            <div className="mt-3 flex items-end gap-2 rounded border border-ink-700 bg-ink-800/40 p-2">
              <label className="text-[11px] text-ink-300">
                <span className="mb-1 block">Ancho</span>
                <input value={bulkW} onChange={(e) => setBulkW(e.target.value)}
                  className="w-16 rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500" />
              </label>
              <span className="pb-1.5 text-ink-500">×</span>
              <label className="text-[11px] text-ink-300">
                <span className="mb-1 block">Alto</span>
                <input value={bulkH} onChange={(e) => setBulkH(e.target.value)}
                  className="w-16 rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500" />
              </label>
              <button type="button" onClick={applyBulk}
                className="ml-auto rounded border border-accent-500/40 px-2 py-1.5 text-[11px] text-accent-300 hover:bg-accent-500/10">
                Aplicar a todas
              </button>
            </div>

            {/* Lista de fotos */}
            <div className="mt-3 space-y-1.5">
              {items === null ? (
                <p className="text-xs text-ink-500">Leyendo fotos…</p>
              ) : items.length === 0 ? (
                <p className="text-xs text-ink-500">No se cargaron fotos.</p>
              ) : items.map((it, i) => (
                <div key={i} className="flex items-center gap-2 rounded border border-ink-700 bg-ink-800/40 p-1.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-ink-950">
                    <img src={it.url} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
                  </div>
                  <span className="text-[10px] text-ink-500">
                    {it.naturalWidth >= it.naturalHeight ? 'apaisada' : 'parada'}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <input value={it.w} onChange={(e) => setItem(i, { w: e.target.value })}
                      className="w-14 rounded border border-ink-700 bg-ink-800 px-1.5 py-1 text-center text-sm text-ink-100 outline-none focus:border-accent-500" />
                    <span className="text-ink-500">×</span>
                    <input value={it.h} onChange={(e) => setItem(i, { h: e.target.value })}
                      className="w-14 rounded border border-ink-700 bg-ink-800 px-1.5 py-1 text-center text-sm text-ink-100 outline-none focus:border-accent-500" />
                    <span className="text-[10px] text-ink-500">mm</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 pt-2 border-t border-ink-700">
              <div className="grid grid-cols-3 gap-2 text-xs text-ink-300">
                <label><span className="mb-1 block">Margen</span>
                  <input value={margin} onChange={(e) => setMargin(e.target.value)}
                    className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500" /></label>
                <label><span className="mb-1 block">Sep. horiz.</span>
                  <input value={spacingX} onChange={(e) => setSpacingX(e.target.value)}
                    className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500" /></label>
                <label><span className="mb-1 block">Sep. vert.</span>
                  <input value={spacingY} onChange={(e) => setSpacingY(e.target.value)}
                    className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500" /></label>
              </div>
            </div>

            {pack && pack.skipped > 0 && (
              <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-200">
                {pack.skipped} foto{pack.skipped === 1 ? '' : 's'} no entran con ese tamaño (más
                grandes que la hoja útil). Achicá la medida o cambiá de hoja.
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-700 px-4 py-3">
          <button type="button" onClick={() => onCancel?.()}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800">Cancelar</button>
          <button type="submit" disabled={!pack || !pack.placed}
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40">
            Armar hoja
          </button>
        </div>
      </form>
    </div>
  );
}
