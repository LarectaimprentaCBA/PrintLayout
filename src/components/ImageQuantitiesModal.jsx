import { useEffect, useMemo, useState } from 'react';

// Panel para elegir cuántas copias de cada foto cargada. Defaultea 1 por foto.
// Al aplicar, devuelve { [imageId]: cantidad } al caller, que rellena la
// plantilla repitiendo hojas según haga falta.
export default function ImageQuantitiesModal({
  open,
  images = [],
  cellsPerPage = 0,
  onConfirm,
  onCancel,
}) {
  const [counts, setCounts] = useState({});
  // Campo libre para "poner a todas" una cantidad escrita por el usuario.
  const [allValue, setAllValue] = useState('');
  // Preview grande al pasar el mouse por una miniatura, para identificar cuál
  // es (las etiquetas se parecen y la miniatura chica no alcanza).
  // { url, name, x, y } | null — x/y son coords de viewport del cursor.
  const [hoverPreview, setHoverPreview] = useState(null);

  // Al abrir (o cambiar las imágenes), arrancar todas en 1.
  useEffect(() => {
    if (!open) return;
    const init = {};
    for (const img of images) init[img.id] = 1;
    setCounts(init);
    setAllValue('');
  }, [open, images]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  // Al cerrar el modal, limpiar el preview flotante.
  useEffect(() => {
    if (!open) setHoverPreview(null);
  }, [open]);

  const setOne = (id, value) => {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    setCounts((prev) => ({ ...prev, [id]: n }));
  };

  const bump = (id, delta) => {
    setCounts((prev) => ({
      ...prev,
      [id]: Math.max(0, (Math.floor(Number(prev[id]) || 0)) + delta),
    }));
  };

  const setAll = (value) => {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    const next = {};
    for (const img of images) next[img.id] = n;
    setCounts(next);
  };

  // Aplica la cantidad escrita en el campo libre a TODAS las imágenes.
  const applyAllTyped = () => {
    if (allValue === '') return;
    setAll(allValue);
  };

  const totalCopies = useMemo(
    () => images.reduce((s, img) => s + (Math.floor(Number(counts[img.id]) || 0)), 0),
    [images, counts],
  );

  const pages = cellsPerPage > 0 ? Math.ceil(totalCopies / cellsPerPage) : 0;

  // Cuántos casilleros quedan libres en las hojas que ya se van a imprimir
  // (sin abrir hojas nuevas). Es lo que "repartir el resto parejo" completaría.
  const remainingCells = useMemo(() => {
    if (cellsPerPage <= 0 || images.length === 0) return 0;
    const basePages = Math.max(1, Math.ceil(totalCopies / cellsPerPage));
    return basePages * cellsPerPage - totalCopies;
  }, [cellsPerPage, images.length, totalCopies]);

  // Reparte los casilleros libres entre TODAS las fotos, de a uno por vuelta
  // (round-robin). No agrega hojas: solo completa las que ya se imprimen.
  const fillEven = () => {
    if (cellsPerPage <= 0 || images.length === 0) return;
    const next = {};
    let total = 0;
    for (const img of images) {
      const n = Math.max(0, Math.floor(Number(counts[img.id]) || 0));
      next[img.id] = n;
      total += n;
    }
    const basePages = Math.max(1, Math.ceil(total / cellsPerPage));
    let remaining = basePages * cellsPerPage - total;
    let i = 0;
    while (remaining > 0) {
      const img = images[i % images.length];
      next[img.id] += 1;
      remaining -= 1;
      i += 1;
    }
    setCounts(next);
  };

  if (!open) return null;

  const submit = (e) => {
    e?.preventDefault();
    if (totalCopies <= 0) return;
    onConfirm?.(counts);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="flex max-h-[90vh] w-[40rem] max-w-[95vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl"
      >
        <div className="border-b border-ink-700 p-4">
          <h3 className="text-sm font-semibold text-ink-100">Cantidad por foto</h3>
          <p className="mt-1 text-xs text-ink-400">
            Indicá cuántas copias querés de cada foto. Se acomodan en la
            plantilla y, si falta lugar, se agregan hojas nuevas con la misma
            plantilla.
            <span className="mt-0.5 block text-ink-500">
              Pasá el mouse por una miniatura para verla en grande e identificarla.
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 px-4 py-2 text-xs text-ink-300">
          <span>Poner a todas:</span>
          {[1, 2, 5, 10].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setAll(n)}
              className="rounded border border-ink-700 bg-ink-800 px-2 py-0.5 hover:bg-ink-700"
            >
              {n}
            </button>
          ))}
          <span className="text-ink-500">o escribí:</span>
          <input
            type="number"
            min="0"
            value={allValue}
            onChange={(e) => setAllValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyAllTyped(); }
            }}
            placeholder="cant."
            className="w-16 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-center text-ink-100 outline-none focus:border-accent-500"
          />
          <button
            type="button"
            onClick={applyAllTyped}
            disabled={allValue === ''}
            className="rounded border border-accent-500/50 bg-accent-600/20 px-2 py-0.5 text-accent-200 hover:bg-accent-600/30 disabled:opacity-40"
          >
            Aplicar a todas
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={fillEven}
              disabled={remainingCells <= 0}
              title="Completa los casilleros libres de las hojas que ya se van a imprimir, repartiéndolos parejo entre todas las fotos (no agrega hojas)."
              className="rounded border border-emerald-500/50 bg-emerald-600/20 px-2 py-0.5 text-emerald-200 hover:bg-emerald-600/30 disabled:opacity-40"
            >
              Repartir el resto parejo
              {remainingCells > 0 && <span className="ml-1 text-emerald-300/80">(+{remainingCells})</span>}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {images.length === 0 ? (
            <p className="p-4 text-center text-xs text-ink-400">
              No hay fotos cargadas. Cargá fotos primero.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {images.map((img) => (
                <li
                  key={img.id}
                  className="flex items-center gap-3 rounded border border-ink-700 bg-ink-800 p-2"
                >
                  <div
                    className="h-16 w-16 shrink-0 overflow-hidden rounded bg-ink-700 ring-1 ring-ink-600 cursor-zoom-in"
                    onMouseEnter={(e) => img.dataUrl && setHoverPreview({ url: img.dataUrl, name: img.name || 'foto', x: e.clientX, y: e.clientY })}
                    onMouseMove={(e) => img.dataUrl && setHoverPreview((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : p))}
                    onMouseLeave={() => setHoverPreview(null)}
                  >
                    {img.dataUrl && (
                      <img
                        src={img.dataUrl}
                        alt={img.name || ''}
                        className="h-full w-full object-contain"
                        draggable={false}
                      />
                    )}
                  </div>
                  <span className="flex-1 break-all text-xs text-ink-200 line-clamp-2" title={img.name}>
                    {img.name || 'foto'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => bump(img.id, -1)}
                      className="h-7 w-7 rounded border border-ink-700 bg-ink-900 text-ink-200 hover:bg-ink-700"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min="0"
                      value={counts[img.id] ?? 1}
                      onChange={(e) => setOne(img.id, e.target.value)}
                      className="w-14 rounded border border-ink-700 bg-ink-900 px-1.5 py-1 text-center text-sm text-ink-100 outline-none focus:border-accent-500"
                    />
                    <button
                      type="button"
                      onClick={() => bump(img.id, 1)}
                      className="h-7 w-7 rounded border border-ink-700 bg-ink-900 text-ink-200 hover:bg-ink-700"
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-700 p-4">
          <span className="mr-auto text-xs text-ink-300">
            Total:{' '}
            <span className="font-semibold text-accent-400">{totalCopies}</span>{' '}
            copia{totalCopies === 1 ? '' : 's'}
            {pages > 0 && (
              <>
                {' '}en{' '}
                <span className="font-semibold text-accent-400">{pages}</span>{' '}
                hoja{pages === 1 ? '' : 's'}
              </>
            )}
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
            disabled={totalCopies <= 0}
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            Acomodar
          </button>
        </div>
      </form>

      {/* Preview grande flotante junto al cursor (position:fixed → no lo
          recorta el overflow del listado). pointer-events-none para que nunca
          bloquee el hover ni los botones. */}
      {hoverPreview && (() => {
        const BOX = 340; // ancho/alto máx del preview en px
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        let left = hoverPreview.x + 24;
        if (left + BOX > vw - 8) left = hoverPreview.x - BOX - 24;
        if (left < 8) left = 8;
        let top = hoverPreview.y - BOX / 2;
        top = Math.max(8, Math.min(top, vh - BOX - 8));
        return (
          <div
            className="pointer-events-none fixed z-[60] flex flex-col overflow-hidden rounded-lg border border-ink-600 bg-ink-950/95 p-2 shadow-2xl ring-1 ring-black/40"
            style={{ left, top, width: BOX }}
          >
            <img
              src={hoverPreview.url}
              alt=""
              className="max-h-[300px] w-full rounded object-contain"
              draggable={false}
            />
            <span className="mt-1.5 break-all text-center text-[11px] text-ink-200">
              {hoverPreview.name}
            </span>
          </div>
        );
      })()}
    </div>
  );
}
