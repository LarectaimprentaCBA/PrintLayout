import { useEffect, useMemo, useRef, useState } from 'react';
import { computeBestGrid, BUILTIN_PAPER_PRESETS } from '../lib/grid.js';
import GridPreview from './GridPreview.jsx';

function parseNum(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// `presets` (opcional) reemplaza la lista de tama&ntilde;os de hoja. Cuando no se
// provee, caemos a los built-in - asi el modal funciona standalone si alguien lo
// usa fuera del App.
export default function GridUploadModal({
  open,
  onConfirm,
  onCancel,
  presets,
  onOpenPresetsEditor,
  // Modo edición: si `initial` viene cargado, el modal arranca con esos valores
  // (medidas de una plantilla existente) y cambian los textos. Montar con un
  // `key` distinto por plantilla para que el prefill se aplique en limpio.
  initial = null,
  title = 'Nueva grilla rápida',
  description = 'Hoja en blanco con celdas uniformes. No se guarda como plantilla — al cerrar la app se descarta.',
  submitLabel = 'Crear grilla',
  // Forma de corte inicial cuando no viene `initial.cutShape` (ej. 'circle' al
  // crear una plantilla redonda para un mazo Dobble).
  defaultCutShape = 'rect',
}) {
  const paperList = useMemo(
    () => (Array.isArray(presets) && presets.length > 0 ? presets : BUILTIN_PAPER_PRESETS),
    [presets],
  );

  const ini = initial || {};
  const s = (v, d) => (v != null && v !== '' ? String(v) : d);
  const defaultPaperId = paperList[0]?.id || 'a4';
  // En edición arrancamos en "custom" con la hoja de la plantilla (así el
  // efecto de sync de presets no pisa las medidas prefilled).
  const [paperId, setPaperId] = useState(initial ? 'custom' : defaultPaperId);
  const [paperW, setPaperW] = useState(s(ini.paperW, '210'));
  const [paperH, setPaperH] = useState(s(ini.paperH, '297'));
  const [cellW, setCellW] = useState(s(ini.cellW, '70'));
  const [cellH, setCellH] = useState(s(ini.cellH, '50'));
  const [margin, setMargin] = useState(s(ini.margin, '0'));
  const [spacingX, setSpacingX] = useState(s(ini.spacingX, '0'));
  const [spacingY, setSpacingY] = useState(s(ini.spacingY, '0'));
  const [cutMargin, setCutMargin] = useState(s(ini.cutMargin, '0'));
  const [markMargin, setMarkMargin] = useState(s(ini.markMargin, '10'));
  const [doubleSided, setDoubleSided] = useState(!!ini.doubleSided);
  const [cutShape, setCutShape] = useState(ini.cutShape || defaultCutShape || 'rect'); // 'rect' | 'circle'
  const [diameter, setDiameter] = useState(s(ini.diameter, '60'));
  const [rotateMode, setRotateMode] = useState(ini.rotateMode || 'auto'); // 'auto' | 'direct' | 'rotated'
  const cellWRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    // window.focus() recupera foco del SO si la ventana lo perdio (caso
    // reportado: modal abria con seleccion gris y campos no tomaban teclado
    // hasta clickear afuera). focus() antes de select() garantiza que el input
    // quede activo aunque .select() falle silente.
    const focusField = () => {
      cellWRef.current?.focus();
      cellWRef.current?.select();
    };
    const t = setTimeout(() => {
      if (typeof window !== 'undefined') window.focus();
      focusField();
    }, 0);
    // Si la ventana recupera el foco del SO y ningun campo del modal habia
    // quedado activo (seleccion gris), reenfocamos el campo asi se puede
    // escribir sin tener que clickear de nuevo. Solo si el foco estaba perdido,
    // para no robarle el foco a otro campo que el usuario este editando.
    const onWinFocus = () => {
      const ae = document.activeElement;
      if (!ae || ae === document.body) focusField();
    };
    window.addEventListener('focus', onWinFocus);
    return () => {
      clearTimeout(t);
      window.removeEventListener('focus', onWinFocus);
    };
    // cutShape en deps: al cambiar Rectangular<->Circulo se re-enfoca el campo
    // visible (cellWRef apunta al input que esta montado en cada modo).
  }, [open, cutShape]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  // Cuando elegis un preset, sincroniza paperW/H. "custom" no toca.
  // Si el preset desaparece de la lista (caso borrado mientras esta abierto el modal),
  // re-seteamos al primer preset disponible.
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

  const params = useMemo(() => {
    const d = parseNum(diameter);
    const isCircle = cutShape === 'circle';
    return {
      paperW: parseNum(paperW),
      paperH: parseNum(paperH),
      // En circulo, ancho=alto=diametro: el corte es inscripto en el cuadrado.
      cellW: isCircle ? d : parseNum(cellW),
      cellH: isCircle ? d : parseNum(cellH),
      marginX: parseNum(margin) || 0,
      marginY: parseNum(margin) || 0,
      spacingX: parseNum(spacingX) || 0,
      spacingY: parseNum(spacingY) || 0,
    };
  }, [paperW, paperH, cellW, cellH, diameter, cutShape, margin, spacingX, spacingY]);

  const valid = (
    params.paperW > 0 && params.paperH > 0
    && params.cellW > 0 && params.cellH > 0
  );

  const result = useMemo(
    () => (valid ? computeBestGrid(params, { rotateMode }) : null),
    [params, valid, rotateMode],
  );

  // En auto, tambien calculamos la otra orientacion para mostrar el "hubiera entrado X"
  // como hint cuando el modo manual sale peor.
  const autoResult = useMemo(
    () => (valid && rotateMode !== 'auto' ? computeBestGrid(params, { rotateMode: 'auto' }) : null),
    [params, valid, rotateMode],
  );

  if (!open) return null;

  const cutMarginMm = Math.max(0, parseNum(cutMargin) || 0);
  const markMarginMm = Math.max(0, parseNum(markMargin) || 0);
  const willCut = result?.cells?.length > 0 && markMarginMm > 0;

  // Si el usuario forzo una orientacion peor que auto, le avisamos cuanto perdio.
  const autoHint =
    autoResult
    && result
    && autoResult.cells.length > result.cells.length
      ? autoResult.cells.length - result.cells.length
      : 0;

  const submit = (e) => {
    e?.preventDefault();
    if (!valid || !result || result.cells.length === 0) return;
    onConfirm?.({
      paperWidthMm: params.paperW,
      paperHeightMm: params.paperH,
      cells: result.cells,
      cols: result.cols,
      rows: result.rows,
      cutMarginMm,
      markMarginMm,
      cutShape,
      doubleSided,
      // Parámetros crudos de la grilla: se guardan en la plantilla para poder
      // re-editar las medidas con exactitud más adelante.
      gridParams: {
        paperW: params.paperW,
        paperH: params.paperH,
        cellW: params.cellW,
        cellH: params.cellH,
        margin: parseNum(margin) || 0,
        spacingX: params.spacingX,
        spacingY: params.spacingY,
        cutMargin: cutMarginMm,
        markMargin: markMarginMm,
        cutShape,
        diameter: parseNum(diameter) || 0,
        rotateMode,
      },
    });
  };

  const orientationLabel =
    result?.orientation === 'rotated' ? 'rotada 90&deg;' : 'directa';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <form
        onSubmit={submit}
        className="flex max-h-[92vh] w-[64rem] max-w-[95vw] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl"
      >
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Preview a la izquierda, grande */}
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center bg-ink-950 p-4">
            <GridPreview
              paperW={params.paperW}
              paperH={params.paperH}
              cells={result?.cells ?? []}
              marginX={params.marginX}
              marginY={params.marginY}
              cutShape={cutShape}
              cutMarginMm={cutMarginMm}
              markMarginMm={markMarginMm}
              maxW={620}
              maxH={580}
            />
            <div className="mt-3 text-center text-xs">
              {result && result.cells.length > 0 ? (
                <>
                  <span className="text-ink-200">
                    <span className="font-semibold text-accent-400">
                      {result.cells.length}
                    </span>{' '}
                    celdas&nbsp;
                    <span className="text-ink-400">
                      ({result.cols} &times; {result.rows}, celda{' '}
                      <span dangerouslySetInnerHTML={{ __html: orientationLabel }} />)
                    </span>
                  </span>
                  {autoHint > 0 && (
                    <div className="mt-0.5 text-[10px] text-amber-400">
                      En auto entrar&iacute;an {autoHint} celda{autoHint === 1 ? '' : 's'} m&aacute;s.
                    </div>
                  )}
                </>
              ) : (
                <span className="text-red-300">
                  No entra ninguna celda con esos valores.
                </span>
              )}
            </div>
          </div>

          {/* Formulario a la derecha, scrolleable */}
          <div className="flex w-[24rem] shrink-0 flex-col overflow-y-auto border-l border-ink-700 p-4">
            <h3 className="text-sm font-semibold text-ink-100">{title}</h3>
            <p className="mt-1 text-xs text-ink-400">{description}</p>

            <div className="mt-4 space-y-3">
          <label className="block text-xs text-ink-300">
            <div className="mb-1 flex items-center justify-between">
              <span>Tama&ntilde;o de hoja</span>
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

          <div>
            <span className="block mb-1 text-xs text-ink-300">Forma de corte</span>
            <div className="flex gap-1 rounded border border-ink-700 bg-ink-800 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setCutShape('rect')}
                className={`flex-1 rounded px-2 py-1 ${
                  cutShape === 'rect'
                    ? 'bg-accent-600 text-white'
                    : 'text-ink-300 hover:bg-ink-700'
                }`}
              >
                Rectangular
              </button>
              <button
                type="button"
                onClick={() => setCutShape('circle')}
                className={`flex-1 rounded px-2 py-1 ${
                  cutShape === 'circle'
                    ? 'bg-accent-600 text-white'
                    : 'text-ink-300 hover:bg-ink-700'
                }`}
              >
                C&iacute;rculo
              </button>
            </div>
          </div>

          {cutShape === 'rect' ? (
            <div className="grid grid-cols-2 gap-2 text-xs text-ink-300">
              <label>
                <span className="block mb-1">Ancho celda (mm)</span>
                <input
                  ref={cellWRef}
                  autoFocus
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
          ) : (
            <label className="block text-xs text-ink-300">
              <span className="block mb-1">Di&aacute;metro (mm)</span>
              <input
                ref={cellWRef}
                autoFocus
                value={diameter}
                onChange={(e) => setDiameter(e.target.value)}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              />
            </label>
          )}

          {/* Rotacion - solo si la celda no es cuadrada (con celda cuadrada
              no hay diferencia, asi que ocultamos el control para no confundir) */}
          {cutShape === 'rect' && params.cellW !== params.cellH && (
            <div>
              <span className="block mb-1 text-xs text-ink-300">
                Rotaci&oacute;n de celda
              </span>
              <div className="flex gap-1 rounded border border-ink-700 bg-ink-800 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setRotateMode('auto')}
                  title="Elige automaticamente la orientacion que rinda mas celdas."
                  className={`flex-1 rounded px-2 py-1 ${
                    rotateMode === 'auto'
                      ? 'bg-accent-600 text-white'
                      : 'text-ink-300 hover:bg-ink-700'
                  }`}
                >
                  Auto
                </button>
                <button
                  type="button"
                  onClick={() => setRotateMode('direct')}
                  title="Celda en orientacion original (ancho x alto)."
                  className={`flex-1 rounded px-2 py-1 ${
                    rotateMode === 'direct'
                      ? 'bg-accent-600 text-white'
                      : 'text-ink-300 hover:bg-ink-700'
                  }`}
                >
                  Directa
                </button>
                <button
                  type="button"
                  onClick={() => setRotateMode('rotated')}
                  title="Celda rotada 90 grados (alto x ancho)."
                  className={`flex-1 rounded px-2 py-1 ${
                    rotateMode === 'rotated'
                      ? 'bg-accent-600 text-white'
                      : 'text-ink-300 hover:bg-ink-700'
                  }`}
                >
                  Rotada 90&deg;
                </button>
              </div>
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

          <div className="pt-2 mt-2 border-t border-ink-700">
            <p className="mb-2 text-[10px] uppercase tracking-wide text-ink-500">
              Corte en plotter (opcional)
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs text-ink-300">
              <label title="Cuanto se mete la cuchilla hacia adentro de la celda. 0 = corta justo en el borde.">
                <span className="block mb-1">Margen de corte (mm)</span>
                <input
                  value={cutMargin}
                  onChange={(e) => setCutMargin(e.target.value)}
                  className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                />
              </label>
              <label title="Distancia desde el borde de la hoja a las marcas L de registro. Pone 0 para no imprimir marcas (no podras cortar con plotter).">
                <span className="block mb-1">Margen de marcas (mm)</span>
                <input
                  value={markMargin}
                  onChange={(e) => setMarkMargin(e.target.value)}
                  className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                />
              </label>
            </div>
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
                  Agrega una cara de dorso con la misma grilla. Vas a poder
                  cargar imágenes en frente y dorso, e imprimir cada cara por
                  separado.
                </span>
              </span>
            </label>
          </div>
        </div>

            {/* Resumen secundario debajo de las opciones */}
            {result && result.cells.length > 0 && (
              <div className="mt-3 rounded border border-ink-700 bg-ink-800 p-2 text-[11px] text-ink-400">
                {willCut ? (
                  <>
                    Cortes{cutShape === 'circle' ? ' circulares' : ''}:{' '}
                    {cutMarginMm > 0 ? (
                      <>{cutMarginMm} mm adentro de cada celda</>
                    ) : (
                      <>exacto al borde de cada celda</>
                    )}
                    {' · '}marcas L a {markMarginMm} mm del borde de hoja
                  </>
                ) : (
                  <>Sin cortes (margen de marcas en 0)</>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer fijo */}
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
            disabled={!result || result.cells.length === 0}
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
