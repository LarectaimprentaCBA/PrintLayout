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
  const [cutMargin, setCutMargin] = useState('0');
  const [markMargin, setMarkMargin] = useState('10');
  const [cutShape, setCutShape] = useState('rect'); // 'rect' | 'circle'
  const [diameter, setDiameter] = useState('60');
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

  const result = useMemo(() => (valid ? computeBestGrid(params) : null), [params, valid]);

  const cellOrientationUsed = useMemo(() => {
    if (!result || result.cells.length === 0) return null;
    const c = result.cells[0];
    if (Math.abs(c.w - params.cellW) < 0.01 && Math.abs(c.h - params.cellH) < 0.01) return 'directa';
    return 'rotada 90°';
  }, [result, params]);

  if (!open) return null;

  const cutMarginMm = Math.max(0, parseNum(cutMargin) || 0);
  const markMarginMm = Math.max(0, parseNum(markMargin) || 0);
  const willCut = result?.cells?.length > 0 && markMarginMm > 0;

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
                Círculo
              </button>
            </div>
          </div>

          {cutShape === 'rect' ? (
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
          ) : (
            <label className="block text-xs text-ink-300">
              <span className="block mb-1">Diámetro (mm)</span>
              <input
                ref={cellWRef}
                value={diameter}
                onChange={(e) => setDiameter(e.target.value)}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              />
            </label>
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
        </div>

        <div className="mt-4 rounded border border-ink-700 bg-ink-800 p-3 text-xs">
          {result && result.cells.length > 0 ? (
            <>
              <p className="text-ink-200">
                <span className="font-semibold text-accent-400">{result.cells.length}</span>{' '}
                celdas por hoja{' '}
                <span className="text-ink-400">
                  ({result.cols} × {result.rows}, celda {cellOrientationUsed})
                </span>
              </p>
              <p className="mt-1 text-ink-400">
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
              </p>
            </>
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
