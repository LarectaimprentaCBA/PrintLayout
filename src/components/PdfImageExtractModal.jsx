import { useEffect, useMemo, useState } from 'react';

const COLS_STORAGE_KEY = 'printlayout.pdfExtract.cols';
const COLS_MIN = 2;
const COLS_MAX = 7;
const COLS_DEFAULT = 5;

function loadStoredCols() {
  const stored = parseInt(localStorage.getItem(COLS_STORAGE_KEY), 10);
  if (Number.isFinite(stored) && stored >= COLS_MIN && stored <= COLS_MAX) {
    return stored;
  }
  return COLS_DEFAULT;
}

export default function PdfImageExtractModal({
  open,
  fileName,
  images = [],
  mode = 'embedded', // 'embedded' | 'rasterized' | 'regions'
  busy = false,
  onConfirm,
  onCancel,
  onSwitchToRasterized,
  onSwitchToRegions,
  // Posado frente/dorso: solo disponible si la plantilla actual es doble faz.
  poseAvailable = false,
  onPose,
}) {
  const [selected, setSelected] = useState(() => new Set());
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [gridCols, setGridCols] = useState(loadStoredCols);
  // Rol de cada pieza para el posado. Ausente = 'front'. { xref: 'dorso' }.
  const [roles, setRoles] = useState({});
  // Con 2+ dorsos, qué dorso usa cada frente (override manual). { frontXref: dorsoXref }.
  const [dorsoOverride, setDorsoOverride] = useState({});

  useEffect(() => {
    if (open) {
      setSelected(new Set(images.map((img) => img.xref)));
      setIncludeDuplicates(false);
      setRoles({});
      setDorsoOverride({});
    }
  }, [open, images]);

  useEffect(() => {
    localStorage.setItem(COLS_STORAGE_KEY, String(gridCols));
  }, [gridCols]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const totalToImport = useMemo(() => {
    let n = 0;
    for (const img of images) {
      if (!selected.has(img.xref)) continue;
      n += includeDuplicates ? Math.max(1, img.placements || 1) : 1;
    }
    return n;
  }, [images, selected, includeDuplicates]);

  const hasDuplicates = useMemo(
    () => images.some((img) => (img.placements || 1) > 1),
    [images],
  );

  const roleOf = (xref) => (roles[xref] === 'dorso' ? 'dorso' : 'front');

  // Piezas seleccionadas por rol, en el orden en que vienen del PDF.
  const dorsoPieces = useMemo(
    () => images.filter((im) => selected.has(im.xref) && roleOf(im.xref) === 'dorso'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [images, selected, roles],
  );
  const frontPieces = useMemo(
    () => images.filter((im) => selected.has(im.xref) && roleOf(im.xref) === 'front'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [images, selected, roles],
  );

  // Índice de cada pieza en el orden del PDF (para "dorso más cercano antes").
  const idxByXref = useMemo(() => {
    const m = new Map();
    images.forEach((im, i) => m.set(im.xref, i));
    return m;
  }, [images]);

  // Dorso que le toca a un frente: override manual → si no, el dorso que aparece
  // ANTES más cerca en el PDF (así "dorso y después su grupo" agrupa solo) → si
  // no hay ninguno antes, el primer dorso.
  const dorsoForFront = (frontXref) => {
    if (dorsoPieces.length === 0) return null;
    const ov = dorsoOverride[frontXref];
    if (ov) {
      const d = dorsoPieces.find((x) => x.xref === ov);
      if (d) return d;
    }
    if (dorsoPieces.length === 1) return dorsoPieces[0];
    const fi = idxByXref.get(frontXref);
    let best = null;
    for (const d of dorsoPieces) {
      const di = idxByXref.get(d.xref);
      if (di < fi && (!best || di > idxByXref.get(best.xref))) best = d;
    }
    return best || dorsoPieces[0];
  };

  const canPose = poseAvailable && dorsoPieces.length > 0 && frontPieces.length > 0;
  const poseFrontsCount = useMemo(() => {
    if (!canPose) return 0;
    return frontPieces.reduce(
      (s, f) => s + (includeDuplicates ? Math.max(1, f.placements || 1) : 1),
      0,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPose, frontPieces, includeDuplicates]);

  if (!open) return null;

  const toggle = (xref) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(xref)) next.delete(xref);
      else next.add(xref);
      return next;
    });
  };

  const cycleRole = (xref) => {
    setRoles((prev) => {
      const next = { ...prev };
      if (next[xref] === 'dorso') delete next[xref];
      else next[xref] = 'dorso';
      return next;
    });
    // Asegurar que la pieza quede seleccionada al marcarla como dorso.
    setSelected((prev) => (prev.has(xref) ? prev : new Set(prev).add(xref)));
  };

  const selectAll = () => setSelected(new Set(images.map((img) => img.xref)));
  const selectNone = () => setSelected(new Set());

  const submit = (e) => {
    e?.preventDefault();
    const chosen = images
      .filter((img) => selected.has(img.xref))
      .map((img) => ({
        ...img,
        copies: includeDuplicates ? Math.max(1, img.placements || 1) : 1,
      }));
    onConfirm?.(chosen);
  };

  const submitPose = () => {
    if (!canPose) return;
    const pairs = frontPieces.map((f) => ({
      front: { ...f, copies: includeDuplicates ? Math.max(1, f.placements || 1) : 1 },
      back: dorsoForFront(f.xref),
    }));
    onPose?.({ pairs });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="flex max-h-[90vh] w-[60rem] max-w-[95vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl"
      >
        <div className="border-b border-ink-700 p-4">
          <h3 className="text-sm font-semibold text-ink-100">
            {mode === 'rasterized'
              ? 'Importar páginas del PDF (a curvas)'
              : mode === 'regions'
                ? 'Piezas del PDF (cada imagen con su forma real)'
                : 'Importar imágenes desde PDF'}
          </h3>
          {fileName && (
            <p className="mt-1 truncate text-xs text-ink-400" title={fileName}>
              {fileName}
            </p>
          )}
          <p className="mt-1 text-xs text-ink-400">
            {images.length === 0
              ? 'No se encontraron imágenes embebidas en este PDF.'
              : mode === 'rasterized'
                ? `${images.length} página${images.length === 1 ? '' : 's'} del PDF rasterizadas a 300dpi. Elegí cuáles importar.`
                : mode === 'regions'
                  ? `${images.length} pieza${images.length === 1 ? '' : 's'} recortada${images.length === 1 ? '' : 's'} del PDF (cada imagen con lo que tiene encima). Elegí cuáles importar.`
                  : `${images.length} imágenes encontradas. Elegí las que querés importar.`}
          </p>

          {poseAvailable && images.length > 0 && (
            <div className="mt-2 rounded border border-accent-500/30 bg-accent-500/5 px-3 py-2 text-[11px] text-ink-300">
              <b className="text-accent-200">Posar frente y dorso:</b> marcá cuál pieza es el{' '}
              <b>dorso</b> (botón «Dorso» en cada una). Las demás son frentes. Al tocar{' '}
              <b>«Posar frente y dorso»</b> se arma la hoja doble faz emparejando cada frente
              con el dorso. Si hay 2 dorsos, cada frente usa el dorso que aparece antes (podés
              cambiarlo en el selector de cada frente).
            </div>
          )}

          {images.length > 0 && (mode === 'embedded' || mode === 'regions') && (
            <div className="mt-2 flex flex-wrap gap-2">
              {mode === 'embedded' && onSwitchToRegions && (
                <button
                  type="button"
                  onClick={onSwitchToRegions}
                  disabled={busy}
                  title="Recorta cada imagen del PDF desde la página, con su forma real y lo que tenga encima. Útil cuando las imágenes salen en blanco o cortadas (stickers con transparencia)."
                  className="rounded border border-accent-500/40 bg-accent-500/10 px-2 py-1 text-[11px] text-accent-200 hover:bg-accent-500/20 disabled:opacity-50"
                >
                  {busy ? 'Procesando…' : '¿Salen en blanco o cortadas? Recortar cada pieza'}
                </button>
              )}
              {onSwitchToRasterized && (
                <button
                  type="button"
                  onClick={onSwitchToRasterized}
                  disabled={busy}
                  title="Usar cada página completa como una sola imagen, en vez de las imágenes sueltas que están adentro. Útil cuando el PDF tiene capas o fondos."
                  className="rounded border border-ink-700 bg-ink-800/60 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-800 disabled:opacity-50"
                >
                  {busy ? 'Procesando…' : 'Usar páginas enteras'}
                </button>
              )}
            </div>
          )}

          {images.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={selectAll}
                className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800"
              >
                Seleccionar todo
              </button>
              <button
                type="button"
                onClick={selectNone}
                className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800"
              >
                Ninguna
              </button>
              {hasDuplicates && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-200">
                  <input
                    type="checkbox"
                    checked={includeDuplicates}
                    onChange={(e) => setIncludeDuplicates(e.target.checked)}
                    className="h-4 w-4 accent-accent-500"
                  />
                  <span>
                    Incluir duplicadas
                    <span className="ml-1 text-ink-500">
                      (importar tantas copias como aparezcan en el PDF)
                    </span>
                  </span>
                </label>
              )}
              <div className="ml-auto flex items-center gap-1 text-xs text-ink-300">
                <span className="text-ink-400">Tamaño</span>
                <button
                  type="button"
                  onClick={() => setGridCols((c) => Math.min(COLS_MAX, c + 1))}
                  disabled={gridCols >= COLS_MAX}
                  title="Achicar miniaturas"
                  className="flex h-6 w-6 items-center justify-center rounded border border-ink-700 text-ink-200 hover:bg-ink-800 disabled:opacity-30"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => setGridCols((c) => Math.max(COLS_MIN, c - 1))}
                  disabled={gridCols <= COLS_MIN}
                  title="Agrandar miniaturas"
                  className="flex h-6 w-6 items-center justify-center rounded border border-ink-700 text-ink-200 hover:bg-ink-800 disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {images.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-ink-500">
              Probá con otro PDF.
            </div>
          ) : (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
            >
              {images.map((img) => {
                const isSelected = selected.has(img.xref);
                const dup = (img.placements || 1) > 1;
                const role = roleOf(img.xref);
                const isDorso = role === 'dorso';
                return (
                  <button
                    type="button"
                    key={img.xref}
                    onClick={() => toggle(img.xref)}
                    className={`relative flex flex-col overflow-hidden rounded border text-left transition ${
                      isSelected
                        ? isDorso
                          ? 'border-amber-500 bg-ink-800 ring-2 ring-amber-500/50'
                          : 'border-accent-500 bg-ink-800 ring-2 ring-accent-500/50'
                        : 'border-ink-700 bg-ink-800/40 hover:border-ink-600'
                    }`}
                  >
                    <div className="flex aspect-square items-center justify-center bg-ink-950 p-2">
                      {img.thumbBase64 ? (
                        <img
                          src={`data:image/png;base64,${img.thumbBase64}`}
                          alt={`Imagen ${img.xref}`}
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-xs text-ink-500">sin preview</span>
                      )}
                    </div>
                    <div className="border-t border-ink-700 p-2 text-[11px] text-ink-300">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-ink-400">
                          {img.width}×{img.height}
                        </span>
                        <span className="text-ink-500">
                          {formatBytes(img.sizeBytes)}
                        </span>
                      </div>
                      {dup && (
                        <div className="mt-1 text-amber-300">
                          aparece {img.placements}×
                        </div>
                      )}
                      {/* Control de rol para el posado (solo doble faz). */}
                      {poseAvailable && isSelected && (
                        <div className="mt-1.5 flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); cycleRole(img.xref); }}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              isDorso
                                ? 'bg-amber-600 text-white hover:bg-amber-500'
                                : 'border border-ink-600 text-ink-300 hover:border-accent-500 hover:text-ink-100'
                            }`}
                          >
                            {isDorso ? '◄ DORSO' : 'Marcar como dorso'}
                          </button>
                          {!isDorso && dorsoPieces.length >= 2 && (
                            <select
                              value={dorsoForFront(img.xref)?.xref ?? ''}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                const v = e.target.value;
                                setDorsoOverride((prev) => ({ ...prev, [img.xref]: v }));
                              }}
                              className="rounded border border-ink-700 bg-ink-900 px-1 py-0.5 text-[10px] text-ink-200 outline-none"
                            >
                              {dorsoPieces.map((d, di) => (
                                <option key={d.xref} value={d.xref}>{`Dorso ${di + 1}`}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <div className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${isDorso ? 'bg-amber-500' : 'bg-accent-500'}`}>
                        {isDorso ? 'D' : '✓'}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-700 p-4">
          <span className="mr-auto text-xs text-ink-400">
            {canPose
              ? `Posar ${poseFrontsCount} frente${poseFrontsCount === 1 ? '' : 's'} con ${dorsoPieces.length === 1 ? 'su dorso' : `${dorsoPieces.length} dorsos`}`
              : totalToImport > 0
                ? `Se importarán ${totalToImport} imagen${totalToImport === 1 ? '' : 'es'}`
                : 'Ninguna seleccionada'}
          </span>
          <button
            type="button"
            onClick={() => onCancel?.()}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
          >
            Cancelar
          </button>
          {canPose && (
            <button
              type="button"
              onClick={submitPose}
              className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500"
            >
              Posar frente y dorso
            </button>
          )}
          <button
            type="submit"
            disabled={totalToImport === 0}
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            Importar
          </button>
        </div>
      </form>
    </div>
  );
}

function formatBytes(n) {
  if (!n || n < 1024) return `${n || 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
