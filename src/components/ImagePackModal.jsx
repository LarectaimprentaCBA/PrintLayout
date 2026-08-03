import { useEffect, useMemo, useRef, useState } from 'react';
import { PAPER_PRESETS } from '../lib/grid.js';
import { packImagesByFixedDimension } from '../lib/imagePacking.js';

function parseNum(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// `presets` (opcional): usa las hojas guardadas del usuario (las mismas de la
// grilla rápida). Si no viene, cae a los built-in (A4/A3).
export default function ImagePackModal({
  open, files = [], onConfirm, onCancel, qrConfig = null,
  presets, onOpenPresetsEditor,
}) {
  const paperList = useMemo(
    () => (Array.isArray(presets) && presets.length > 0 ? presets : PAPER_PRESETS),
    [presets],
  );
  const [fixedDim, setFixedDim] = useState('alto');
  const [fixedValue, setFixedValue] = useState('50'); // 5 cm
  const [paperId, setPaperId] = useState(paperList[0]?.id || 'a4');
  const [paperW, setPaperW] = useState(String(paperList[0]?.w ?? 210));
  const [paperH, setPaperH] = useState(String(paperList[0]?.h ?? 297));
  const [margin, setMargin] = useState('5');
  const [spacingX, setSpacingX] = useState('2');
  const [spacingY, setSpacingY] = useState('2');
  // Corte en plotter (opcional). markMargin=0 → sin corte (solo imprimir).
  // El corte es el MISMO en todas las hojas (todas comparten el layout de la 1ª).
  const [cutMargin, setCutMargin] = useState('0');
  const [markMargin, setMarkMargin] = useState('0');
  const [cutShape, setCutShape] = useState('rect'); // 'rect' | 'circle'
  const [repeatToFill, setRepeatToFill] = useState(false);
  // "Con QR": reserva simétrica arriba y abajo (para cortar por QR sin que pise
  // la última fila). Default OFF: el acomodar es primero para imprimir.
  const [conQr, setConQr] = useState(false);
  const [imageDims, setImageDims] = useState(null); // [{naturalWidth, naturalHeight}]
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setImageDims(null);
    setTimeout(() => inputRef.current?.select(), 0);
    // Cargar dimensiones de cada archivo en paralelo.
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
    if (paperId === 'custom') return;
    const preset = paperList.find((p) => p.id === paperId);
    if (preset) {
      setPaperW(String(preset.w));
      setPaperH(String(preset.h));
    } else {
      setPaperId(paperList[0]?.id || 'custom');
    }
  }, [paperId, paperList]);

  const params = useMemo(() => ({
    paperW: parseNum(paperW),
    paperH: parseNum(paperH),
    fixedValueMm: parseNum(fixedValue),
    marginX: parseNum(margin) ?? 0,
    marginY: parseNum(margin) ?? 0,
    spacingX: parseNum(spacingX) ?? 0,
    spacingY: parseNum(spacingY) ?? 0,
  }), [paperW, paperH, fixedValue, margin, spacingX, spacingY]);

  const valid = (
    params.paperW > 0 && params.paperH > 0 && params.fixedValueMm > 0
  );

  // Reserva del QR (misma fórmula que la grilla rápida): franja simétrica arriba
  // y abajo. La aplicamos INFLANDO el margen vertical del acomodo → las celdas
  // quedan centradas dejando el lugar del QR abajo, sin tocar el motor de packing.
  const qrBottomMm = Number(qrConfig?.qrBottomMm ?? 9.5);
  const qrSizeMm = Number(qrConfig?.qrSizeMm ?? 8);
  const qrReserveMm = conQr
    ? Math.max(0, qrBottomMm + qrSizeMm / 2 + 1 + 1 - params.marginY)
    : 0;

  const pack = useMemo(() => {
    if (!valid || !imageDims) return null;
    return packImagesByFixedDimension({
      images: imageDims,
      fixedDim,
      fixedValueMm: params.fixedValueMm,
      paperW: params.paperW,
      paperH: params.paperH,
      marginX: params.marginX,
      marginY: params.marginY + qrReserveMm,
      spacingX: params.spacingX,
      spacingY: params.spacingY,
      repeatToFill,
      multiPage: true,
    });
  }, [valid, imageDims, fixedDim, params, repeatToFill, qrReserveMm]);

  // Tamaño de la celda que se crea. En "por tamaño" un lado es fijo (el que
  // elegís) y el otro sale del aspecto de cada imagen: si son todas iguales, la
  // celda es única; si varían, mostramos el rango.
  const cellSizeText = useMemo(() => {
    if (!pack || !pack.cells || pack.cells.length === 0) return null;
    const r1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
    const ws = pack.cells.map((c) => Math.round(c.w * 10) / 10);
    const hs = pack.cells.map((c) => Math.round(c.h * 10) / 10);
    const wMin = Math.min(...ws), wMax = Math.max(...ws);
    const hMin = Math.min(...hs), hMax = Math.max(...hs);
    const wStr = wMin === wMax ? r1(wMin) : `${r1(wMin)}–${r1(wMax)}`;
    const hStr = hMin === hMax ? r1(hMin) : `${r1(hMin)}–${r1(hMax)}`;
    if (wMin === wMax && hMin === hMax) {
      return `Cada celda mide ${wStr} × ${hStr} mm (ancho × alto).`;
    }
    return `Celda: ${wStr} mm (ancho) × ${hStr} mm (alto) — el lado libre varía según cada imagen.`;
  }, [pack]);

  const [previewPage, setPreviewPage] = useState(0);

  useEffect(() => {
    setPreviewPage(0);
  }, [pack?.pageCount]);

  if (!open) return null;

  const submit = (e) => {
    e?.preventDefault();
    if (!pack || pack.cells.length === 0) return;
    // Reducir a files unicos en el orden en que aparecen por primera vez,
    // y construir cellMapping con indices nuevos.
    const usedIndices = [];
    const remap = new Map();
    for (const c of pack.cells) {
      if (!remap.has(c.imageIndex)) {
        remap.set(c.imageIndex, usedIndices.length);
        usedIndices.push(c.imageIndex);
      }
    }
    const usedFiles = usedIndices.map((idx) => files[idx]);
    // Construir las paginas con sus celdas; el orden global de cells refleja
    // page-by-page, asi que cellMapping en orden flat tambien es consistente.
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
      repeated: repeatToFill,
      pageCount: pack.pageCount,
      conQr,
      // Corte en plotter: mismo corte para todas las hojas (layout de la 1ª).
      cutMarginMm: Math.max(0, parseNum(cutMargin) || 0),
      markMarginMm: Math.max(0, parseNum(markMargin) || 0),
      cutShape,
      // Receta del acomodo "por tamaño": se guarda en la plantilla para poder
      // RE-ACOMODAR después (ej. "cantidad por foto") respetando el tamaño físico.
      autoPack: {
        mode: 'size',
        fixedDim,
        fixedValueMm: params.fixedValueMm,
        marginX: params.marginX,
        marginY: params.marginY,
        spacingX: params.spacingX,
        spacingY: params.spacingY,
      },
    });
  };

  // Preview a escala. Box max 280x280 px aprox.
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
          <h3 className="text-sm font-semibold text-ink-100">Auto-acomodar imágenes</h3>
          <p className="mt-1 text-xs text-ink-400">
            Fijás una dimensión (alto o ancho) y el resto se calcula proporcional
            al aspecto de cada imagen. Las que no entren en una hoja se descartan.
          </p>
        </div>

        <div className="flex flex-1 gap-4 overflow-y-auto p-4">
          <div className="w-[20rem] shrink-0 space-y-3">
            <div>
              <span className="block mb-1 text-xs text-ink-300">Dimensión fija</span>
              <div className="flex gap-1 rounded border border-ink-700 bg-ink-800 p-0.5">
                <button
                  type="button"
                  onClick={() => setFixedDim('alto')}
                  className={`flex-1 rounded px-2 py-1 text-xs ${
                    fixedDim === 'alto'
                      ? 'bg-accent-600 text-white'
                      : 'text-ink-300 hover:text-ink-100'
                  }`}
                >
                  Alto
                </button>
                <button
                  type="button"
                  onClick={() => setFixedDim('ancho')}
                  className={`flex-1 rounded px-2 py-1 text-xs ${
                    fixedDim === 'ancho'
                      ? 'bg-accent-600 text-white'
                      : 'text-ink-300 hover:text-ink-100'
                  }`}
                >
                  Ancho
                </button>
              </div>
            </div>

            <label className="block text-xs text-ink-300">
              <span className="block mb-1">
                {fixedDim === 'alto' ? 'Alto' : 'Ancho'} (mm)
              </span>
              <input
                ref={inputRef}
                value={fixedValue}
                onChange={(e) => setFixedValue(e.target.value)}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              />
            </label>

            <label className="block text-xs text-ink-300">
              <div className="mb-1 flex items-center justify-between">
                <span>Tamaño de hoja</span>
                {onOpenPresetsEditor && (
                  <button
                    type="button"
                    onClick={onOpenPresetsEditor}
                    className="text-[10px] text-accent-400 hover:text-accent-300"
                  >
                    Gestionar hojas…
                  </button>
                )}
              </div>
              <select
                value={paperId}
                onChange={(e) => setPaperId(e.target.value)}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              >
                {paperList.map((p) => (
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

            <div className="pt-2 mt-2 border-t border-ink-700">
              <p className="mb-2 text-[10px] uppercase tracking-wide text-ink-500">
                Corte en plotter (opcional)
              </p>
              <div className="mb-2">
                <span className="block mb-1 text-xs text-ink-300">Forma de corte</span>
                <div className="flex gap-1 rounded border border-ink-700 bg-ink-800 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setCutShape('rect')}
                    className={`flex-1 rounded px-2 py-1 ${
                      cutShape === 'rect' ? 'bg-accent-600 text-white' : 'text-ink-300 hover:bg-ink-700'
                    }`}
                  >
                    Rectangular
                  </button>
                  <button
                    type="button"
                    onClick={() => setCutShape('circle')}
                    className={`flex-1 rounded px-2 py-1 ${
                      cutShape === 'circle' ? 'bg-accent-600 text-white' : 'text-ink-300 hover:bg-ink-700'
                    }`}
                  >
                    Círculo
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-ink-300">
                <label title="Cuánto se mete la cuchilla hacia adentro de cada celda. 0 = corta justo en el borde.">
                  <span className="block mb-1">Margen de corte (mm)</span>
                  <input
                    value={cutMargin}
                    onChange={(e) => setCutMargin(e.target.value)}
                    className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
                <label title="Distancia del borde de la hoja a las marcas L. Poné más de 0 para poder cortar; 0 = sin corte (solo imprimir).">
                  <span className="block mb-1">Margen de marcas (mm)</span>
                  <input
                    value={markMargin}
                    onChange={(e) => setMarkMargin(e.target.value)}
                    className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
              </div>
              <p className="mt-1 text-[10px] leading-snug text-ink-500">
                {parseNum(markMargin) > 0
                  ? 'El mismo corte se aplica a todas las hojas (todas comparten el tamaño de celda de la 1ª).'
                  : 'Margen de marcas en 0 = sin corte (solo imprimir). Poné más de 0 para cortar por plotter.'}
              </p>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-200">
              <input
                type="checkbox"
                checked={repeatToFill}
                onChange={(e) => setRepeatToFill(e.target.checked)}
                className="h-4 w-4 accent-accent-500"
              />
              <span>
                Rellenar huecos repitiendo imágenes
                <span className="ml-1 text-ink-500">
                  (después de paginar, cicla las imágenes en cada hoja hasta llenarla)
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2 text-xs text-ink-200">
              <input
                type="checkbox"
                checked={conQr}
                onChange={(e) => setConQr(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-accent-500"
              />
              <span>
                Con QR (reservar espacio para cortar)
                <span className="block text-[10px] leading-snug text-ink-500">
                  Deja una franja libre arriba y abajo (posado centrado) para que el
                  QR de corte no pise la última fila. Tildalo si vas a cortar esta hoja
                  por QR.{conQr && qrReserveMm > 0 ? ` Reserva ~${qrReserveMm.toFixed(1)} mm.` : ''}
                </span>
              </span>
            </label>

            <div className="rounded border border-ink-700 bg-ink-800 p-2.5 text-xs">
              {imageDims === null ? (
                <p className="text-ink-400">Leyendo dimensiones de las imágenes…</p>
              ) : !pack ? (
                <p className="text-red-300">Parámetros inválidos.</p>
              ) : pack.cells.length === 0 ? (
                <p className="text-red-300">
                  Ninguna imagen entra con esos parámetros. Probá reducir{' '}
                  {fixedDim === 'alto' ? 'el alto' : 'el ancho'} o cambiar la hoja.
                </p>
              ) : repeatToFill ? (
                <>
                  <p className="text-ink-200">
                    {pack.uniqueUsed} de {pack.total} imágen{pack.total === 1 ? '' : 'es'} en{' '}
                    <span className="font-semibold text-accent-400">
                      {pack.pageCount} hoja{pack.pageCount === 1 ? '' : 's'}
                    </span>
                    , con <span className="font-semibold text-accent-400">{pack.cells.length}</span> celdas en total
                    {pack.cells.length > pack.uniqueUsed ? ' (huecos rellenados)' : ''}.
                  </p>
                  {pack.uniqueUsed < pack.total && (
                    <p className="mt-1 text-amber-300">
                      {pack.total - pack.uniqueUsed} sin usar (más grandes que la hoja).
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-ink-200">
                    {pack.uniqueUsed} de {pack.total} imágen{pack.total === 1 ? '' : 'es'} acomodada
                    {pack.uniqueUsed === 1 ? '' : 's'} en{' '}
                    <span className="font-semibold text-accent-400">
                      {pack.pageCount} hoja{pack.pageCount === 1 ? '' : 's'}
                    </span>
                    .
                  </p>
                  {pack.uniqueUsed < pack.total && (
                    <p className="mt-1 text-amber-300">
                      {pack.total - pack.uniqueUsed} se descartan
                      {(() => {
                        const tooBig = pack.skipped.filter((s) => s.reason === 'no entra').length;
                        const noFit = pack.skipped.filter((s) => s.reason === 'sin espacio en la hoja').length;
                        const parts = [];
                        if (tooBig) parts.push(`${tooBig} más grandes que la hoja`);
                        if (noFit) parts.push(`${noFit} sin lugar`);
                        return parts.length ? ` (${parts.join(', ')})` : '';
                      })()}
                    </p>
                  )}
                </>
              )}
              {cellSizeText && (
                <p className="mt-1.5 border-t border-ink-700 pt-1.5 font-medium text-accent-300">
                  {cellSizeText}
                </p>
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
                  {qrReserveMm > 0 && (
                    <>
                      <div
                        className="absolute left-0 right-0 top-0 border-b border-dashed border-amber-500/60 bg-amber-400/15"
                        style={{ height: (params.marginY + qrReserveMm) * previewScale }}
                      />
                      <div
                        className="absolute left-0 right-0 bottom-0 flex items-center justify-center border-t border-dashed border-amber-500/60 bg-amber-400/15"
                        style={{ height: (params.marginY + qrReserveMm) * previewScale }}
                      >
                        <span className="text-[8px] text-amber-700">QR</span>
                      </div>
                    </>
                  )}
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
