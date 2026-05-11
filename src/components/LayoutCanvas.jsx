import { useEffect, useRef, useState } from 'react';
import {
  cellPositions,
  cellsForPage,
  pageStartOffset,
  fixedPageCount,
} from '../lib/templates.js';
import { coverObjectPosition } from '../lib/faceDetection.js';
import { renderPdfPage1Preview } from '../lib/pdfPreview.js';
import CellSlot from './CellSlot.jsx';

const PX_PER_MM_AT_100 = 3.78;

export default function LayoutCanvas({
  template,
  assignments,
  imageMap,
  selectedCell,
  layoutFitMode = 'contain',
  cellsPerPage,
  pageCount,
  currentPage,
  onPageChange,
  onCellClick,
  showBackground = true,
  showCuts = false,
  face = 'front',
  onUploadPdfClick,
  onCreateGridClick,
}) {
  const scrollRef = useRef(null);
  const [fitScale, setFitScale] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [previewUrl, setPreviewUrl] = useState(null);

  // Recalcula el scale base que hace fit en el viewport.
  useEffect(() => {
    if (!template || !scrollRef.current) return;
    const el = scrollRef.current;

    const fit = () => {
      const padding = 64;
      const availW = el.clientWidth - padding;
      const availH = el.clientHeight - padding;
      const sheetWpx = template.pageWidthMm * PX_PER_MM_AT_100;
      const sheetHpx = template.pageHeightMm * PX_PER_MM_AT_100;
      const s = Math.min(availW / sheetWpx, availH / sheetHpx, 1);
      setFitScale(s > 0 ? s : 1);
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [template]);

  // Reset zoom cuando cambia la plantilla.
  useEffect(() => {
    setZoomLevel(1);
  }, [template?.id]);

  const scale = fitScale * zoomLevel;

  const clampZoom = (z) => Math.max(0.25, Math.min(z, 6));
  const zoomIn = () => setZoomLevel((z) => clampZoom(z * 1.2));
  const zoomOut = () => setZoomLevel((z) => clampZoom(z / 1.2));
  const zoomReset = () => setZoomLevel(1);

  // Ctrl + rueda = zoom centrado en el cursor.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorRelX = e.clientX - rect.left;
      const cursorRelY = e.clientY - rect.top;
      const contentX = el.scrollLeft + cursorRelX;
      const contentY = el.scrollTop + cursorRelY;

      setZoomLevel((prev) => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const next = clampZoom(prev * factor);
        const realFactor = next / prev;
        requestAnimationFrame(() => {
          el.scrollLeft = contentX * realFactor - cursorRelX;
          el.scrollTop = contentY * realFactor - cursorRelY;
        });
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [template?.id]);

  useEffect(() => {
    let cancelled = false;
    setPreviewUrl(null);
    if (!template) return;
    (async () => {
      try {
        const url = await renderPdfPage1Preview(template, 110);
        if (!cancelled) setPreviewUrl(url);
      } catch (err) {
        console.error('No se pudo renderizar el preview:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [template?.id]);


  if (!template) {
    return (
      <main className="flex flex-1 items-center justify-center overflow-auto bg-ink-950 p-8">
        <div className="flex flex-col items-center gap-4 text-ink-400">
          <div className="flex h-[60vh] w-[42vh] flex-col items-center justify-center gap-4 rounded-md border border-dashed border-ink-600 bg-ink-900 px-8 shadow-2xl">
            <span className="text-center text-sm text-ink-300">
              Subí o seleccioná una plantilla para empezar
            </span>
            <div className="flex w-full flex-col gap-2">
              {onUploadPdfClick && (
                <button
                  onClick={onUploadPdfClick}
                  className="rounded bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500"
                >
                  + Subir PDF
                </button>
              )}
              {onCreateGridClick && (
                <button
                  onClick={onCreateGridClick}
                  className="rounded border border-accent-500/40 bg-ink-800 px-4 py-2 text-sm font-medium text-accent-300 hover:bg-ink-700"
                >
                  + Grilla rápida
                </button>
              )}
            </div>
            <p className="text-center text-[11px] text-ink-500">
              La grilla rápida es una hoja en blanco con celdas uniformes que vive solo en esta sesión.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const isMultiPage = fixedPageCount(template) !== null;
  const cells = isMultiPage
    ? cellsForPage(template, currentPage ?? 0, face)
    : cellPositions(template, face);
  const sheetW = template.pageWidthMm * PX_PER_MM_AT_100 * scale;
  const sheetH = template.pageHeightMm * PX_PER_MM_AT_100 * scale;
  const pageOffset = isMultiPage
    ? pageStartOffset(template, currentPage ?? 0, face)
    : (currentPage ?? 0) * (cellsPerPage ?? cells.length);
  const totalPages = pageCount ?? 1;
  const pxPerMm = PX_PER_MM_AT_100 * scale;

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden bg-ink-950">
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) onCellClick?.(null);
        }}
      >
        <div
          className="flex min-h-full w-max min-w-full items-center justify-center p-8"
          onClick={(e) => {
            if (e.target === e.currentTarget) onCellClick?.(null);
          }}
        >
          <div
            className="relative bg-white shadow-2xl"
            style={{ width: sheetW, height: sheetH }}
          >
            {showBackground && previewUrl && (
              <img
                src={previewUrl}
                alt=""
                draggable={false}
                className="pointer-events-none absolute inset-0 h-full w-full select-none"
              />
            )}
            {cells.map((cell, i) => {
              const x = cell.x * pxPerMm;
              const y = cell.y * pxPerMm;
              const w = cell.w * pxPerMm;
              const h = cell.h * pxPerMm;
              const globalIdx = pageOffset + i;
              const imgId = assignments?.[globalIdx] ?? null;
              const img = imgId ? imageMap?.get(imgId) : null;
              const fitMode = img?.fitOverride ?? layoutFitMode;
              const objectPosition =
                img && fitMode === 'cover'
                  ? coverObjectPosition(img, cell.w, cell.h)
                  : null;

              return (
                <CellSlot
                  key={globalIdx}
                  cellIdx={globalIdx}
                  image={img}
                  isSelected={selectedCell === globalIdx}
                  fitMode={fitMode}
                  objectPosition={objectPosition}
                  onClick={onCellClick}
                  style={{ left: x, top: y, width: w, height: h }}
                />
              );
            })}
            {showCuts && template.cortes && template.cortes.length > 0 && (
              <svg
                viewBox={`0 0 ${template.pageWidthMm} ${template.pageHeightMm}`}
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 z-20 h-full w-full"
              >
                {template.cortes.map((poly, i) => (
                  <polyline
                    key={i}
                    points={poly.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth={1.2}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
            )}
          </div>
        </div>
      </div>

      {/* Paginador (centrado abajo) */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md border border-ink-700 bg-ink-900/90 px-2 py-1 text-[11px] text-ink-300 backdrop-blur"
        style={{ pointerEvents: 'auto' }}>
        <button
          type="button"
          disabled={(currentPage ?? 0) <= 0}
          onClick={() => onPageChange?.((currentPage ?? 0) - 1)}
          className="rounded px-1.5 py-0.5 text-ink-200 hover:bg-ink-800 disabled:opacity-30"
          title="Hoja anterior"
        >
          ‹
        </button>
        <span>
          Hoja <span className="text-ink-100">{(currentPage ?? 0) + 1}</span> de{' '}
          <span className="text-ink-100">{totalPages}</span>
        </span>
        <button
          type="button"
          disabled={(currentPage ?? 0) >= totalPages - 1}
          onClick={() => onPageChange?.((currentPage ?? 0) + 1)}
          className="rounded px-1.5 py-0.5 text-ink-200 hover:bg-ink-800 disabled:opacity-30"
          title="Hoja siguiente"
        >
          ›
        </button>
      </div>

      {/* Zoom + tamaño hoja (abajo derecha) */}
      <div className="absolute bottom-3 right-4 flex items-center gap-2 rounded-md border border-ink-700 bg-ink-900/90 px-2 py-1 text-[11px] text-ink-300 backdrop-blur">
        <button
          type="button"
          onClick={zoomOut}
          title="Reducir zoom (Ctrl + rueda hacia abajo)"
          className="rounded px-1.5 py-0.5 text-ink-200 hover:bg-ink-800"
        >
          −
        </button>
        <button
          type="button"
          onClick={zoomReset}
          title="Ajustar a la pantalla"
          className="rounded px-1.5 py-0.5 text-ink-200 hover:bg-ink-800"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={zoomIn}
          title="Aumentar zoom (Ctrl + rueda hacia arriba)"
          className="rounded px-1.5 py-0.5 text-ink-200 hover:bg-ink-800"
        >
          +
        </button>
        <span className="ml-1 text-ink-500">
          {Math.round(template.pageWidthMm)} × {Math.round(template.pageHeightMm)} mm
        </span>
      </div>
    </main>
  );
}
