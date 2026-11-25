import { useEffect, useMemo, useRef, useState } from 'react';
import { readFilesToImages } from '../lib/images.js';
import { buildDeckSets, sortByNameNatural, clampSets } from '../lib/deckSets.js';

// "Armar juegos": cargás los FRENTES por un lado y los DORSOS por otro, decís
// cuántos juegos querés, y arma las hojas doble faz: cada juego tiene una carta
// de cada frente, y los dorsos se reparten (uno por juego, o carta por carta).
// Ej.: 14 frentes + 20 dorsos + 20 juegos = 280 cartas, juego 1 con el dorso 1,
// juego 2 con el dorso 2…
// Al confirmar devuelve la lista de cartas { front, back } lista para
// layout.applyFrontBackPairs (los lugares vacíos van con front/back en null).

const ACCEPT = 'image/jpeg,image/png,image/jpg,image/heic,image/heif,.heic,.heif,application/pdf,.pdf';

export default function DeckSetsModal({
  open,
  cellsPerPage = 0,
  initialImages = [],
  onConfirm,
  onCancel,
}) {
  const [fronts, setFronts] = useState([]);
  const [backs, setBacks] = useState([]);
  const [setsText, setSetsText] = useState('');
  const [setsTouched, setSetsTouched] = useState(false);
  const [backMode, setBackMode] = useState('perSet');
  const [newSheetPerSet, setNewSheetPerSet] = useState(false);
  const [picked, setPicked] = useState(() => new Set()); // ids elegidos de "ya cargadas"
  // Cuántas cargas hay en curso en cada lista (se pueden cargar las dos a la vez).
  const [loading, setLoading] = useState({ fronts: 0, backs: 0 });
  const busy = loading.fronts + loading.backs > 0;
  const [error, setError] = useState(null);
  const frontInputRef = useRef(null);
  const backInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setFronts([]);
    setBacks([]);
    setSetsText('');
    setSetsTouched(false);
    setBackMode('perSet');
    setNewSheetPerSet(false);
    setPicked(new Set());
    setLoading({ fronts: 0, backs: 0 });
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  // Mientras no escribas la cantidad de juegos, sigue a la cantidad de dorsos
  // (lo más común: un juego por dorso). Sin dorsos, 1.
  const setsValue = setsTouched ? setsText : String(backs.length || 1);
  const sets = clampSets(setsValue);

  const plan = useMemo(
    () => buildDeckSets({ fronts, backs, sets, backMode, newSheetPerSet, cellsPerPage }),
    [fronts, backs, sets, backMode, newSheetPerSet, cellsPerPage],
  );

  if (!open) return null;

  const setter = (which) => (which === 'fronts' ? setFronts : setBacks);

  const loadFiles = async (which, fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setLoading((l) => ({ ...l, [which]: l[which] + 1 }));
    setError(null);
    try {
      const imgs = await readFilesToImages(files);
      if (imgs.length === 0) setError('No se pudo cargar ninguna imagen.');
      // Por nombre ("dorso 2" antes que "dorso 10"): así el juego 1 lleva el dorso 1.
      const ordenadas = files.some((f) => /\.pdf$/i.test(f.name || '')) ? imgs : sortByNameNatural(imgs);
      setter(which)((prev) => [...prev, ...ordenadas]);
    } catch (err) {
      console.error(err);
      setError(`Error cargando: ${err.message}`);
    } finally {
      setLoading((l) => ({ ...l, [which]: Math.max(0, l[which] - 1) }));
    }
  };

  const removeAt = (which, idx) => setter(which)((prev) => prev.filter((_, i) => i !== idx));

  const addPicked = (which) => {
    const elegidas = initialImages.filter((i) => picked.has(i.id));
    if (elegidas.length === 0) return;
    setter(which)((prev) => [...prev, ...elegidas]);
    setPicked(new Set());
  };
  const togglePicked = (id) => setPicked((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const canSubmit = plan.realCards > 0 && cellsPerPage > 0 && !busy;
  const submit = (e) => {
    e?.preventDefault();
    if (!canSubmit) return;
    onConfirm?.(plan.cards, { sets: plan.sets, perSet: plan.perSet, cards: plan.realCards, pages: plan.pages });
  };

  const Lista = ({ which, titulo, items, inputRef, ayuda }) => (
    <div
      data-lista={which}
      className="flex min-h-0 flex-1 flex-col rounded border border-ink-700 bg-ink-800/60"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer?.files?.length) loadFiles(which, e.dataTransfer.files);
      }}
    >
      <div className="flex items-center gap-2 border-b border-ink-700 px-2 py-1.5">
        <span className="text-xs font-semibold text-ink-100">{titulo}</span>
        <span className="rounded bg-ink-700 px-1.5 text-[11px] tabular-nums text-accent-300" data-cuenta={which}>{items.length}</span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="ml-auto rounded border border-ink-600 bg-ink-800 px-2 py-0.5 text-[11px] text-ink-100 hover:bg-ink-700"
        >
          {loading[which] > 0 ? 'Cargando…' : `+ Cargar ${titulo.toLowerCase()}`}
        </button>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => setter(which)([])}
            className="text-[11px] text-ink-400 hover:text-red-300"
          >
            Vaciar
          </button>
        )}
      </div>
      <div className="max-h-44 min-h-[5rem] overflow-y-auto p-2">
        {items.length === 0 ? (
          <p className="py-4 text-center text-[11px] leading-snug text-ink-500">{ayuda}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {items.map((img, idx) => (
              <button
                key={`${img.id}_${idx}`}
                type="button"
                onClick={() => removeAt(which, idx)}
                title={`${img.name} — clic para quitar`}
                className="group relative h-14 w-14 shrink-0 overflow-hidden rounded border border-ink-600 hover:border-red-400"
              >
                <img src={img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
                <span className="absolute left-0 top-0 rounded-br bg-black/70 px-1 text-[10px] tabular-nums text-white">{idx + 1}</span>
                <span className="absolute inset-0 hidden items-center justify-center bg-black/55 text-sm text-red-200 group-hover:flex">✕</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => { const fl = Array.from(e.target.files || []); e.target.value = ''; loadFiles(which, fl); }}
      />
    </div>
  );

  // Texto de cómo quedan los dorsos.
  let dorsosTxt = '';
  if (plan.realCards > 0) {
    if (backs.length === 0) dorsosTxt = 'Sin dorsos: sale solo el frente.';
    else if (backMode === 'perCard') dorsosTxt = `Los ${backs.length} dorsos se van turnando carta por carta.`;
    else if (backs.length === 1) dorsosTxt = 'Todos los juegos con el mismo dorso.';
    else if (plan.backsUnused > 0) dorsosTxt = `Juego 1 con el dorso 1, juego 2 con el dorso 2… Sobran ${plan.backsUnused} dorso${plan.backsUnused === 1 ? '' : 's'} (hay más dorsos que juegos).`;
    else if (backs.length < plan.sets) dorsosTxt = `Juego 1 con el dorso 1, juego 2 con el dorso 2… y al terminar los ${backs.length} dorsos se repiten desde el primero.`;
    else dorsosTxt = 'Juego 1 con el dorso 1, juego 2 con el dorso 2, y así: cada juego con su dorso.';
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={submit}
        data-modal="armar-juegos"
        className="flex max-h-[92vh] w-[52rem] max-w-[95vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl"
      >
        <div className="border-b border-ink-700 p-4">
          <h3 className="text-sm font-semibold text-ink-100">Armar juegos (frentes + dorsos)</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            Cargá los frentes por un lado y los dorsos por otro. Cada juego lleva <b className="text-ink-200">una carta de
            cada frente</b>, y los dorsos se reparten entre los juegos. Reemplaza lo que haya posado en esta hoja.
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          {initialImages.length > 0 && (
            <div className="rounded border border-ink-700 bg-ink-950/40 p-2">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-ink-400">
                  Ya cargadas en la hoja ({initialImages.length}): marcá las que quieras y mandalas a
                </span>
                <button type="button" onClick={() => addPicked('fronts')} disabled={picked.size === 0}
                  className="rounded border border-ink-600 px-2 py-0.5 text-[11px] text-ink-100 hover:bg-ink-700 disabled:opacity-40">
                  Frentes
                </button>
                <button type="button" onClick={() => addPicked('backs')} disabled={picked.size === 0}
                  className="rounded border border-ink-600 px-2 py-0.5 text-[11px] text-ink-100 hover:bg-ink-700 disabled:opacity-40">
                  Dorsos
                </button>
                <button type="button"
                  onClick={() => setPicked(picked.size === initialImages.length ? new Set() : new Set(initialImages.map((i) => i.id)))}
                  className="ml-auto text-[11px] text-ink-400 hover:text-ink-100">
                  {picked.size === initialImages.length ? 'Desmarcar todas' : 'Marcar todas'}
                </button>
              </div>
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                {initialImages.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => togglePicked(img.id)}
                    title={img.name}
                    className={`h-11 w-11 shrink-0 overflow-hidden rounded border ${
                      picked.has(img.id) ? 'border-accent-500 ring-2 ring-accent-500/50' : 'border-ink-700 hover:border-accent-500/60'
                    }`}
                  >
                    <img src={img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex min-h-0 gap-3">
            {Lista({ which: 'fronts', titulo: 'Frentes', items: fronts, inputRef: frontInputRef,
              ayuda: 'Cargá acá los frentes (imágenes o PDF). También podés arrastrar los archivos desde la carpeta.' })}
            {Lista({ which: 'backs', titulo: 'Dorsos', items: backs, inputRef: backInputRef,
              ayuda: 'Cargá acá los dorsos. Se ordenan por nombre: el primero es el del juego 1.' })}
          </div>

          {error && (
            <div className="rounded border border-red-900 bg-red-950/40 px-2 py-1.5 text-xs text-red-300">{error}</div>
          )}

          <div className="flex flex-wrap items-start gap-x-6 gap-y-3 rounded border border-ink-700 bg-ink-800/60 p-3 text-xs text-ink-200">
            <label className="flex items-center gap-2">
              <span className="text-ink-300">Cantidad de juegos</span>
              <input
                type="number"
                min="1"
                max="500"
                name="cantidadJuegos"
                value={setsValue}
                onChange={(e) => { setSetsTouched(true); setSetsText(e.target.value); }}
                onFocus={(e) => e.target.select()}
                className="w-20 rounded border border-ink-700 bg-ink-950 px-2 py-1 text-center text-sm text-ink-100 outline-none focus:border-accent-500"
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-ink-300">Dorsos</span>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" name="modoDorsos" value="perSet" checked={backMode === 'perSet'} onChange={() => setBackMode('perSet')} className="accent-accent-600" />
                <span>Uno por juego <span className="text-ink-500">(todas las cartas del juego con el mismo dorso)</span></span>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" name="modoDorsos" value="perCard" checked={backMode === 'perCard'} onChange={() => setBackMode('perCard')} className="accent-accent-600" />
                <span>Mezclados <span className="text-ink-500">(se van turnando carta por carta)</span></span>
              </label>
            </div>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" name="hojaNuevaPorJuego" checked={newSheetPerSet} onChange={(e) => setNewSheetPerSet(e.target.checked)} className="accent-accent-600" />
              <span>Cada juego empieza en hoja nueva <span className="text-ink-500">(gasta más hojas)</span></span>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-ink-700 p-4">
          <div className="mr-auto min-w-0 text-xs leading-snug text-ink-300" data-resumen="juegos">
            {plan.realCards > 0 ? (
              <>
                <div>
                  <span className="font-semibold text-accent-400">{plan.sets}</span> juego{plan.sets === 1 ? '' : 's'} de{' '}
                  <span className="font-semibold text-accent-400">{plan.perSet}</span> carta{plan.perSet === 1 ? '' : 's'} ={' '}
                  <span className="font-semibold text-accent-400">{plan.realCards}</span> cartas
                  {cellsPerPage > 0 && (
                    <span className="text-ink-400"> · {plan.pages} hoja{plan.pages === 1 ? '' : 's'} (entran {cellsPerPage} por hoja)</span>
                  )}
                </div>
                <div className={plan.backsUnused > 0 && backMode === 'perSet' ? 'text-amber-300' : 'text-ink-500'}>{dorsosTxt}</div>
              </>
            ) : (
              <span className="text-ink-500">
                {fronts.length === 0 ? 'Cargá los frentes para empezar.' : 'Poné cuántos juegos querés.'}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onCancel?.()}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            Armar juegos
          </button>
        </div>
      </form>
    </div>
  );
}
