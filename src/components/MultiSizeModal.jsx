import { useEffect, useMemo, useState } from 'react';
import { BUILTIN_PAPER_PRESETS } from '../lib/grid.js';
import { packMultiSizePieces, recipeToPieces, fillRecipeEvenly } from '../lib/multiSizePacking.js';
import GridPreview from './GridPreview.jsx';

function parseNum(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

let ROW_ID = 1;
const newRow = (w = '', h = '', qty = '1', shape = 'rect') => ({ key: ROW_ID++, w, h, qty, orient: 'auto', shape });

// Modal "Armar por medidas": el usuario define una receta de casilleros de
// distintos tamaños (ancho×alto + cantidad + orientación) y la app los empaqueta
// apretado mezclando medidas, rotando cuando conviene, y abre hojas nuevas si no
// entran. Devuelve una plantilla multi-hoja con casilleros VACÍOS para llenar
// después con fotos. Comparte diseño y opciones con la grilla rápida
// (GridUploadModal): tamaño de hoja + gestionar hojas, márgenes visibles, corte
// en plotter, "Con QR" y "Doble faz".
export default function MultiSizeModal({
  open,
  onConfirm,
  onCancel,
  presets,
  onOpenPresetsEditor,
  qrConfig = null,
}) {
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
  // Corte en plotter (opcional). markMargin=0 → sin corte (solo imponer).
  const [cutMargin, setCutMargin] = useState('0');
  const [markMargin, setMarkMargin] = useState('0');
  // "Con QR": reserva la franja del QR abajo (cada hoja lleva su propio QR) Y
  // marca template.conQr. Default ON (igual que la grilla rápida).
  const [conQr, setConQr] = useState(true);
  const [doubleSided, setDoubleSided] = useState(false);
  // "Repartir parejo": rellena el sobrante de la hoja sumando más piezas (en
  // ronda entre las medidas) sin abrir hojas nuevas. Respeta las cantidades
  // pedidas como MÍNIMO. Default OFF (si pediste 10 y 10, salen 10 y 10).
  const [fillEven, setFillEven] = useState(false);
  const [rows, setRows] = useState(() => [newRow('100', '150', '3'), newRow('60', '60', '2', 'circle')]);
  const [previewPage, setPreviewPage] = useState(0);

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

  const cutMarginMm = Math.max(0, parseNum(cutMargin) || 0);
  const markMarginMm = Math.max(0, parseNum(markMargin) || 0);
  // Con corte + "Con QR" reservamos una franja abajo para el QR (cada hoja lleva
  // su QR). En doble faz reservamos la MISMA franja arriba y abajo (simétrica)
  // para centrar en la hoja, igual que la grilla rápida.
  const qrBottomMm = Number(qrConfig?.qrBottomMm ?? 9.5);
  const qrSizeMm = Number(qrConfig?.qrSizeMm ?? 8);
  const wantQrReserve = conQr && markMarginMm > 0;
  const bottomReserveMm = wantQrReserve
    ? Math.max(0, qrBottomMm + qrSizeMm / 2 + 2 - marginMm)
    : 0;
  const topReserveMm = doubleSided ? bottomReserveMm : 0;

  const recipe = useMemo(
    () => rows.map((r) => ({
      w: parseNum(r.w), h: parseNum(r.h), qty: parseNum(r.qty), orient: r.orient, shape: r.shape,
    })),
    [rows],
  );

  const pack = useMemo(() => {
    if (!(pW > 0) || !(pH > 0)) return null;
    const pieces = recipeToPieces(recipe);
    if (pieces.length === 0) return null;
    const packParams = {
      paperW: pW, paperH: pH,
      marginX: marginMm, marginY: marginMm, spacingX: spX, spacingY: spY,
      allowRotate: true,
      bottomReserveMm,
      topReserveMm,
    };
    let result;
    let finalCounts = null;
    if (fillEven) {
      const filled = fillRecipeEvenly(recipe, packParams);
      result = filled.result;
      finalCounts = filled.counts;
    } else {
      result = packMultiSizePieces({ ...packParams, pieces });
    }
    // Ids para el preview (clave estable por página) y para las celdas finales.
    let id = 0;
    const pagesWithId = result.pages.map((pageCells) =>
      pageCells.map((c) => ({ id: id++, x: c.x, y: c.y, w: c.w, h: c.h, shape: c.shape })),
    );
    return { ...result, pagesWithId, finalCounts };
  }, [pW, pH, marginMm, spX, spY, recipe, bottomReserveMm, topReserveMm, fillEven]);

  useEffect(() => {
    if (pack && previewPage >= pack.pageCount) setPreviewPage(Math.max(0, pack.pageCount - 1));
  }, [pack, previewPage]);

  if (!open) return null;

  const totalRequested = recipe.reduce(
    (s, r) => s + (r.w > 0 && r.h > 0 && r.qty > 0 ? Math.floor(r.qty) : 0),
    0,
  );
  const willCut = pack && pack.placed > 0 && markMarginMm > 0;

  const updateRow = (key, patch) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  const addRow = () => setRows((rs) => [...rs, newRow()]);

  const submit = (e) => {
    e?.preventDefault();
    if (!pack || pack.placed === 0) return;
    const pages = pack.pagesWithId.map((celdas) => ({ celdas }));
    onConfirm?.({
      paperWidthMm: pW,
      paperHeightMm: pH,
      pages,
      pageCount: pack.pageCount,
      placed: pack.placed,
      skipped: pack.skipped,
      cutMarginMm,
      markMarginMm,
      conQr,
      doubleSided,
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
          {/* Preview a la izquierda, grande */}
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center bg-ink-950 p-4">
            <GridPreview
              paperW={pW || 0}
              paperH={pH || 0}
              cells={curPageCells}
              marginX={marginMm}
              marginY={marginMm}
              cutMarginMm={cutMarginMm}
              markMarginMm={markMarginMm}
              bottomReserveMm={bottomReserveMm}
              topReserveMm={topReserveMm}
              maxW={620}
              maxH={580}
            />
            <div className="mt-3 text-center text-xs">
              {pack && pack.placed > 0 ? (
                <span className="text-ink-200">
                  <span className="font-semibold text-accent-400">{pack.placed}</span> casilleros en{' '}
                  <span className="font-semibold text-accent-400">{pack.pageCount}</span> hoja
                  {pack.pageCount === 1 ? '' : 's'}
                  {pack.skipped > 0 && (
                    <span className="ml-1 text-amber-400">· {pack.skipped} no entran</span>
                  )}
                </span>
              ) : (
                <span className="text-red-300">Cargá medidas y cantidades.</span>
              )}
            </div>
            {pack && pack.pageCount > 1 && (
              <div className="mt-2 flex items-center gap-2 text-xs text-ink-300">
                <button
                  type="button"
                  disabled={previewPage <= 0}
                  onClick={() => setPreviewPage((p) => Math.max(0, p - 1))}
                  className="rounded border border-ink-700 px-2 py-0.5 hover:bg-ink-800 disabled:opacity-40"
                >
                  ‹
                </button>
                <span>Hoja {Math.min(previewPage, pack.pageCount - 1) + 1} de {pack.pageCount}</span>
                <button
                  type="button"
                  disabled={previewPage >= pack.pageCount - 1}
                  onClick={() => setPreviewPage((p) => Math.min(pack.pageCount - 1, p + 1))}
                  className="rounded border border-ink-700 px-2 py-0.5 hover:bg-ink-800 disabled:opacity-40"
                >
                  ›
                </button>
              </div>
            )}
          </div>

          {/* Formulario a la derecha, scrolleable */}
          <div className="flex w-[24rem] shrink-0 flex-col overflow-y-auto border-l border-ink-700 p-4">
            <h3 className="text-sm font-semibold text-ink-100">Armar por medidas</h3>
            <p className="mt-1 text-xs text-ink-400">
              Definí casilleros de distintos tamaños y cantidades. Se acomodan
              apretados en la hoja (rotando cuando conviene) y se abren hojas
              nuevas si no entran. Después llenás los casilleros con fotos.
            </p>

            <div className="mt-4 space-y-3">
              <label className="block text-xs text-ink-300">
                <div className="mb-1 flex items-center justify-between">
                  <span>Tamaño de hoja</span>
                  {onOpenPresetsEditor && (
                    <button
                      type="button"
                      onClick={onOpenPresetsEditor}
                      className="text-[10px] text-accent-400 hover:text-accent-300"
                    >
                      Gestionar hojas...
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
                    <span className="mb-1 block">Ancho hoja (mm)</span>
                    <input
                      value={paperW}
                      onChange={(e) => setPaperW(e.target.value)}
                      className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block">Alto hoja (mm)</span>
                    <input
                      value={paperH}
                      onChange={(e) => setPaperH(e.target.value)}
                      className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                    />
                  </label>
                </div>
              )}

              {/* Receta de medidas (específico de esta plantilla) */}
              <div>
                <div className="mb-1 grid grid-cols-[3.6rem_1fr_1fr_2.6rem_auto_1.25rem] items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-500">
                  <span>Forma</span>
                  <span>Ancho</span>
                  <span>Alto / ⌀</span>
                  <span>Cant.</span>
                  <span>Giro</span>
                  <span />
                </div>
                <div className="space-y-1.5">
                  {rows.map((r) => {
                    const isCircle = r.shape === 'circle';
                    return (
                    <div key={r.key} className="grid grid-cols-[3.6rem_1fr_1fr_2.6rem_auto_1.25rem] items-center gap-1.5">
                      <div className="flex overflow-hidden rounded border border-ink-700 bg-ink-800 text-[12px]">
                        <button
                          type="button"
                          onClick={() => updateRow(r.key, { shape: 'rect' })}
                          title="Rectángulo (ancho × alto)"
                          className={`flex-1 py-1 leading-none ${!isCircle ? 'bg-accent-600 text-white' : 'text-ink-400 hover:bg-ink-700'}`}
                        >
                          ▭
                        </button>
                        <button
                          type="button"
                          onClick={() => updateRow(r.key, { shape: 'circle' })}
                          title="Círculo (diámetro)"
                          className={`flex-1 border-l border-ink-700 py-1 leading-none ${isCircle ? 'bg-accent-600 text-white' : 'text-ink-400 hover:bg-ink-700'}`}
                        >
                          ◯
                        </button>
                      </div>
                      <input
                        value={r.w}
                        onChange={(e) => updateRow(r.key, isCircle ? { w: e.target.value, h: e.target.value } : { w: e.target.value })}
                        placeholder={isCircle ? 'diám.' : 'mm'}
                        title={isCircle ? 'Diámetro del círculo (mm)' : 'Ancho (mm)'}
                        className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
                      />
                      {isCircle ? (
                        <div className="text-center text-[11px] text-ink-500" title="En círculo el alto = diámetro">⌀ {r.w || '—'}</div>
                      ) : (
                        <input
                          value={r.h}
                          onChange={(e) => updateRow(r.key, { h: e.target.value })}
                          placeholder="mm"
                          className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
                        />
                      )}
                      <input
                        value={r.qty}
                        onChange={(e) => updateRow(r.key, { qty: e.target.value })}
                        className="w-full rounded border border-ink-700 bg-ink-800 px-1 py-1 text-center text-sm text-ink-100 outline-none focus:border-accent-500"
                      />
                      {isCircle ? (
                        <div className="text-center text-[10px] text-ink-600" title="Los círculos no rotan">—</div>
                      ) : (
                        <div className="flex overflow-hidden rounded border border-ink-700 bg-ink-800 text-[10px]">
                          <button
                            type="button"
                            onClick={() => updateRow(r.key, { orient: 'auto' })}
                            title="Auto: la app rota la pieza si así entra mejor"
                            className={`px-1.5 py-1 ${r.orient === 'auto' ? 'bg-accent-600 text-white' : 'text-ink-300 hover:bg-ink-700'}`}
                          >
                            Auto
                          </button>
                          <button
                            type="button"
                            onClick={() => updateRow(r.key, { orient: 'fija' })}
                            title="Fija: como la pusiste (no rota)"
                            className={`border-l border-ink-700 px-1.5 py-1 ${r.orient === 'fija' ? 'bg-accent-600 text-white' : 'text-ink-300 hover:bg-ink-700'}`}
                          >
                            Fija
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeRow(r.key)}
                        title="Quitar fila"
                        className="rounded text-ink-500 hover:text-red-300"
                      >
                        ✕
                      </button>
                    </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={addRow}
                  className="mt-2 w-full rounded border border-dashed border-ink-600 px-2 py-1 text-[11px] text-ink-300 hover:border-accent-500/60 hover:text-ink-100"
                >
                  + Agregar medida
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs text-ink-300">
                <label>
                  <span className="mb-1 block">Margen (mm)</span>
                  <input
                    value={margin}
                    onChange={(e) => setMargin(e.target.value)}
                    className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
                <label>
                  <span className="mb-1 block">Sep. horiz. (mm)</span>
                  <input
                    value={spacingX}
                    onChange={(e) => setSpacingX(e.target.value)}
                    className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
                <label>
                  <span className="mb-1 block">Sep. vert. (mm)</span>
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
                <div className="grid grid-cols-2 gap-2 text-xs text-ink-300">
                  <label title="Cuánto se mete la cuchilla hacia adentro de cada casillero. 0 = corta justo en el borde.">
                    <span className="mb-1 block">Margen de corte (mm)</span>
                    <input
                      value={cutMargin}
                      onChange={(e) => setCutMargin(e.target.value)}
                      className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                    />
                  </label>
                  <label title="Distancia del borde de la hoja a las marcas L. Poné más de 0 para poder cortar; 0 = sin corte.">
                    <span className="mb-1 block">Margen de marcas (mm)</span>
                    <input
                      value={markMargin}
                      onChange={(e) => setMarkMargin(e.target.value)}
                      className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                    />
                  </label>
                </div>
                <p className="mt-1 text-[10px] leading-snug text-ink-500">
                  {markMarginMm > 0
                    ? 'Cada casillero se corta con su forma (rectángulo o círculo).'
                    : 'Margen de marcas en 0 = sin corte (solo imponer). Poné más de 0 para cortar por plotter.'}
                </p>
              </div>

              <div className="pt-2 mt-2 border-t border-ink-700">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={conQr}
                    onChange={(e) => setConQr(e.target.checked)}
                    className="mt-0.5 accent-accent-600"
                  />
                  <span className="text-xs">
                    <span className="block text-ink-200">Con QR (reserva el espacio)</span>
                    <span className="block text-[10px] leading-snug text-ink-500">
                      Deja libre una franja para el QR de corte, así no pisa los
                      casilleros. Cada hoja lleva su propio QR y corte.{' '}
                      {markMarginMm <= 0 ? (
                        <span className="text-amber-400">
                          Esta hoja no tiene corte (margen de marcas en 0), así que no
                          reserva nada.
                        </span>
                      ) : conQr && bottomReserveMm > 0 ? (
                        <span className="text-ink-400">
                          Reserva ~{bottomReserveMm.toFixed(1)} mm
                          {doubleSided ? ' arriba y abajo.' : ' abajo.'}
                        </span>
                      ) : (
                        <span className="text-ink-400">
                          Destildado: la hoja usa el alto completo y no se dibuja el QR.
                        </span>
                      )}
                    </span>
                  </span>
                </label>
              </div>

              <div className="pt-2 mt-2 border-t border-ink-700">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={fillEven}
                    onChange={(e) => setFillEven(e.target.checked)}
                    className="mt-0.5 accent-accent-600"
                  />
                  <span className="text-xs">
                    <span className="block text-ink-200">Repartir parejo (rellenar el sobrante)</span>
                    <span className="block text-[10px] leading-snug text-ink-500">
                      Usa el espacio que sobra en la hoja sumando más casilleros,
                      repartidos parejo entre las medidas y sin abrir hojas nuevas.
                      Las cantidades que pusiste son el mínimo.
                    </span>
                  </span>
                </label>
                {fillEven && pack?.finalCounts && (
                  <div className="mt-1.5 space-y-0.5 rounded border border-ink-700 bg-ink-800 p-1.5 text-[10px] text-ink-300">
                    {rows.map((r, i) => {
                      const req = Math.max(0, Math.floor(parseNum(r.qty) || 0));
                      const got = pack.finalCounts[i] ?? req;
                      const label = r.shape === 'circle' ? `⌀${r.w || '?'}` : `${r.w || '?'}×${r.h || '?'}`;
                      return (
                        <div key={r.key} className="flex items-center justify-between">
                          <span className="text-ink-400">{label} mm</span>
                          <span>
                            {req}
                            {got > req && <span className="text-accent-400"> → {got}</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="pt-2 mt-2 border-t border-ink-700">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={doubleSided}
                    onChange={(e) => setDoubleSided(e.target.checked)}
                    className="mt-0.5 accent-accent-600"
                  />
                  <span className="text-xs">
                    <span className="block text-ink-200">Doble faz</span>
                    <span className="block text-[10px] leading-snug text-ink-500">
                      Agrega una cara de dorso con los mismos casilleros. Vas a
                      poder cargar imágenes en frente y dorso, e imprimir cada cara
                      por separado.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {/* Resumen secundario debajo de las opciones */}
            {pack && pack.placed > 0 && (
              <div className="mt-3 rounded border border-ink-700 bg-ink-800 p-2 text-[11px] text-ink-400">
                {willCut ? (
                  <>
                    Cortes por casillero:{' '}
                    {cutMarginMm > 0 ? (
                      <>{cutMarginMm} mm adentro de cada uno</>
                    ) : (
                      <>exacto al borde de cada uno</>
                    )}
                    {' · '}marcas L a {markMarginMm} mm del borde de hoja
                    {pack.pageCount > 1 && <> · un QR/corte por hoja</>}
                  </>
                ) : (
                  <>Sin cortes (margen de marcas en 0)</>
                )}
              </div>
            )}

            {pack && pack.skipped > 0 && (
              <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-200">
                {pack.skipped} de {totalRequested} casilleros no entran (son más grandes
                que la hoja útil o no quedó lugar). Probá otra hoja o achicá medidas.
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-700 px-4 py-3">
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
