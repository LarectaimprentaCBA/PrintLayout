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
  onConfirm,
  onCancel,
}) {
  const [selected, setSelected] = useState(() => new Set());
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [gridCols, setGridCols] = useState(loadStoredCols);

  useEffect(() => {
    if (open) {
      setSelected(new Set(images.map((img) => img.xref)));
      setIncludeDuplicates(false);
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

  if (!open) return null;

  const toggle = (xref) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(xref)) next.delete(xref);
      else next.add(xref);
      return next;
    });
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="flex max-h-[90vh] w-[60rem] max-w-[95vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl"
      >
        <div className="border-b border-ink-700 p-4">
          <h3 className="text-sm font-semibold text-ink-100">
            Importar imágenes desde PDF
          </h3>
          {fileName && (
            <p className="mt-1 truncate text-xs text-ink-400" title={fileName}>
              {fileName}
            </p>
          )}
          <p className="mt-1 text-xs text-ink-400">
            {images.length === 0
              ? 'No se encontraron imágenes embebidas en este PDF.'
              : `${images.length} imágenes encontradas. Elegí las que querés importar.`}
          </p>

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
                return (
                  <button
                    type="button"
                    key={img.xref}
                    onClick={() => toggle(img.xref)}
                    className={`relative flex flex-col overflow-hidden rounded border text-left transition ${
                      isSelected
                        ? 'border-accent-500 bg-ink-800 ring-2 ring-accent-500/50'
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
                    </div>
                    {isSelected && (
                      <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent-500 text-[10px] font-bold text-white">
                        ✓
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
            {totalToImport > 0
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
