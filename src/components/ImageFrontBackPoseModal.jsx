import { useEffect, useMemo, useRef, useState } from 'react';
import { readFilesToImages } from '../lib/images.js';

// Modal para posar pares frente/dorso. Flujo:
//  1) Cargás todas las imágenes/PDF en la bandeja de arriba (un PDF entra como
//     una imagen por página).
//  2) Arrastrás cada imagen al Frente o Dorso de cada tarjeta (o la seleccionás
//     con un click y después clickeás el casillero).
//  3) Ponés la cantidad de cada tarjeta y Posás.
// Al confirmar devuelve la lista de tarjetas { front, back } ya expandida por
// cantidad. Cualquier cara puede quedar vacía.

let rowSeq = 0;
const newRow = () => ({ key: `row_${rowSeq++}`, front: null, back: null, qty: '1' });

export default function ImageFrontBackPoseModal({
  open,
  cellsPerPage = 0,
  initialImages = [],
  onConfirm,
  onCancel,
}) {
  const [tray, setTray] = useState([]); // image objects cargados
  const [rows, setRows] = useState([newRow()]);
  const [selectedTrayId, setSelectedTrayId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const dragImgRef = useRef(null); // imagen que se está arrastrando

  useEffect(() => {
    if (!open) return;
    // La bandeja arranca con las imágenes que ya cargaste en el editor; podés
    // sumar más con "Cargar imágenes / PDF".
    setTray(Array.isArray(initialImages) ? [...initialImages] : []);
    setRows([newRow()]);
    setSelectedTrayId(null);
    setError(null);
  }, [open, initialImages]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const setRow = (key, patch) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const handleLoadFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const imgs = await readFilesToImages(files);
      if (imgs.length === 0) setError('No se pudo cargar ninguna imagen.');
      setTray((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...imgs.filter((i) => !seen.has(i.id))];
      });
    } catch (err) {
      console.error(err);
      setError(`Error cargando: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // Asigna una imagen a un casillero (front/back) de una fila.
  const assign = (key, slot, img) => setRow(key, { [slot]: img });

  // Click en casillero: si hay imagen seleccionada en la bandeja, la coloca;
  // si no, alterna limpiar (si ya tenía imagen).
  const onSlotClick = (row, slot) => {
    const sel = tray.find((t) => t.id === selectedTrayId);
    if (sel) {
      assign(row.key, slot, sel);
    } else if (row[slot]) {
      assign(row.key, slot, null);
    }
  };

  const addRow = () => setRows((prev) => [...prev, newRow()]);
  const removeRow = (key) =>
    setRows((prev) => (prev.length <= 1 ? [newRow()] : prev.filter((r) => r.key !== key)));

  const totalCards = useMemo(
    () =>
      rows.reduce((s, r) => {
        if (!r.front && !r.back) return s;
        return s + Math.max(0, Math.floor(Number(r.qty) || 0));
      }, 0),
    [rows],
  );

  if (!open) return null;

  // Tarjetas definidas (filas con al menos una cara cargada).
  const definedPairs = rows.filter((r) => r.front || r.back);

  const submit = (e) => {
    e?.preventDefault();
    if (totalCards <= 0 || busy) return;
    const cards = [];
    for (const r of rows) {
      if (!r.front && !r.back) continue;
      const q = Math.max(0, Math.floor(Number(r.qty) || 0));
      for (let k = 0; k < q; k++) cards.push({ front: r.front, back: r.back });
    }
    if (cards.length === 0) return;
    onConfirm?.(cards);
  };

  // Repartir parejo: llena UNA plancha (cellsPerPage celdas) repartiendo las
  // tarjetas definidas en partes iguales (agrupadas: A A A B B B ...). Ignora
  // la cantidad de cada fila. Pensado para "tengo estos diseños, llename la
  // hoja parejo con todos".
  const poseEven = () => {
    const K = definedPairs.length;
    const N = cellsPerPage;
    if (K === 0 || N <= 0 || busy) return;
    const base = Math.floor(N / K);
    const extras = N % K;
    const cards = [];
    for (let k = 0; k < K; k++) {
      const copies = k < extras ? base + 1 : base;
      for (let c = 0; c < copies; c++) {
        cards.push({ front: definedPairs[k].front, back: definedPairs[k].back });
      }
    }
    if (cards.length === 0) return;
    onConfirm?.(cards);
  };

  const Slot = ({ row, slot, label }) => {
    const img = row[slot];
    return (
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide text-ink-500">{label}</span>
        <div
          onClick={() => onSlotClick(row, slot)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dragImgRef.current) assign(row.key, slot, dragImgRef.current);
          }}
          className={`relative flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded border bg-ink-800 ${
            img ? 'border-ink-600' : 'border-dashed border-ink-600 hover:border-accent-500'
          }`}
          title={img ? `${img.name} — click para quitar` : `Arrastrá una imagen acá`}
        >
          {img ? (
            <img src={img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xl font-light text-ink-500">+</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="flex max-h-[90vh] w-[46rem] max-w-[95vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl"
      >
        <div className="border-b border-ink-700 p-4">
          <h3 className="text-sm font-semibold text-ink-100">Posar frente y dorso</h3>
          <p className="mt-1 text-xs text-ink-400">
            Cargá todas las imágenes/PDF arriba y arrastrá cada una al Frente o
            Dorso de cada tarjeta (o seleccioná una y clickeá el casillero).
            Poné la cantidad y posá: se acomodan emparejadas y paginan solas.
          </p>
        </div>

        {/* Bandeja de imágenes */}
        <div className="border-b border-ink-700 bg-ink-950/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-50"
            >
              {busy ? 'Cargando…' : '+ Cargar imágenes / PDF'}
            </button>
            {tray.length > 0 && (
              <>
                <span className="text-[11px] text-ink-500">
                  {tray.length} imagen{tray.length === 1 ? '' : 'es'} · arrastrá o
                  seleccioná y clickeá un casillero
                </span>
                <button
                  type="button"
                  onClick={() => { setTray([]); setSelectedTrayId(null); }}
                  className="ml-auto text-[11px] text-ink-400 hover:text-red-300"
                >
                  Vaciar bandeja
                </button>
              </>
            )}
          </div>
          {tray.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-ink-500">
              La bandeja está vacía. Cargá las imágenes o PDF de tus frentes y dorsos.
            </p>
          ) : (
            <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
              {tray.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  draggable
                  onDragStart={() => { dragImgRef.current = img; }}
                  onDragEnd={() => { dragImgRef.current = null; }}
                  onClick={() =>
                    setSelectedTrayId((id) => (id === img.id ? null : img.id))
                  }
                  title={img.name}
                  className={`h-14 w-14 shrink-0 overflow-hidden rounded border ${
                    selectedTrayId === img.id
                      ? 'border-accent-500 ring-2 ring-accent-500/50'
                      : 'border-ink-700 hover:border-accent-500/60'
                  }`}
                >
                  <img src={img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="mx-4 mt-3 rounded border border-red-900 bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Filas de tarjetas */}
        <div className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-2">
            {rows.map((r, idx) => (
              <li
                key={r.key}
                className="flex items-center gap-3 rounded border border-ink-700 bg-ink-800 p-2"
              >
                <span className="w-5 shrink-0 text-center text-xs text-ink-500">{idx + 1}</span>
                <Slot row={r} slot="front" label="Frente" />
                <Slot row={r} slot="back" label="Dorso" />
                <label className="ml-auto flex flex-col items-center gap-1 text-[10px] uppercase tracking-wide text-ink-500">
                  Cantidad
                  <input
                    type="number"
                    min="1"
                    value={r.qty}
                    onChange={(e) => setRow(r.key, { qty: e.target.value })}
                    className="w-16 rounded border border-ink-700 bg-ink-900 px-1.5 py-1 text-center text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeRow(r.key)}
                  title="Quitar fila"
                  className="ml-1 rounded border border-ink-700 px-2 py-1 text-xs text-ink-400 hover:bg-ink-700 hover:text-red-300"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={addRow}
            className="mt-2 rounded border border-dashed border-ink-600 px-3 py-1.5 text-xs text-ink-300 hover:border-accent-500 hover:text-ink-100"
          >
            + Agregar tarjeta
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/jpg,image/heic,image/heif,.heic,.heif,application/pdf,.pdf"
          className="hidden"
          onChange={handleLoadFiles}
        />

        <div className="flex items-center justify-end gap-2 border-t border-ink-700 p-4">
          <span className="mr-auto text-xs text-ink-300">
            <span className="font-semibold text-accent-400">{definedPairs.length}</span>{' '}
            diseño{definedPairs.length === 1 ? '' : 's'}
            {cellsPerPage > 0 && (
              <span className="text-ink-500"> · la hoja tiene {cellsPerPage} lugares</span>
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
            type="button"
            onClick={poseEven}
            disabled={definedPairs.length === 0 || cellsPerPage <= 0 || busy}
            title="Llenar una hoja repartiendo las tarjetas en partes iguales"
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            Repartir parejo
          </button>
          <button
            type="submit"
            disabled={totalCards <= 0 || busy}
            title="Posar usando la cantidad indicada en cada tarjeta (puede ocupar varias hojas)"
            className="rounded border border-ink-600 px-3 py-1 text-xs font-medium text-ink-100 hover:bg-ink-800 disabled:opacity-40"
          >
            Por cantidad
          </button>
        </div>
      </form>
    </div>
  );
}
