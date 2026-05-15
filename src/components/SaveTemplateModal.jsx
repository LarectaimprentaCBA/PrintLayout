import { useEffect, useRef, useState } from 'react';

// Modal simple para guardar una grilla temporal como plantilla permanente.
// Pide nombre y categoria (opcional, con autocomplete).
export default function SaveTemplateModal({
  open,
  defaultName = '',
  defaultCategoria = '',
  existingCategories = [],
  onConfirm,
  onCancel,
}) {
  const [name, setName] = useState(defaultName);
  const [categoria, setCategoria] = useState(defaultCategoria);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setName(defaultName || '');
    setCategoria(defaultCategoria || '');
    setTimeout(() => inputRef.current?.select(), 0);
  }, [open, defaultName, defaultCategoria]);

  if (!open) return null;

  const submit = (e) => {
    e?.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onConfirm?.({ name: trimmedName, categoria: categoria.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={submit}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel?.(); }}
        className="w-96 rounded-lg border border-ink-700 bg-ink-900 p-4 shadow-2xl"
      >
        <h3 className="text-sm font-semibold text-ink-100">Guardar plantilla</h3>
        <p className="mt-1 text-[11px] text-ink-400">
          La plantilla pasa a la lista permanente y se mantiene entre sesiones.
        </p>

        <label className="mt-4 block text-xs text-ink-300">
          <span className="mb-1 block">Nombre</span>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Stickers redondos 40 mm"
            className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
          />
        </label>

        <label className="mt-3 block text-xs text-ink-300">
          <span className="mb-1 block">Carpeta (opcional)</span>
          <input
            list="save-template-categorias"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            placeholder="Sin carpeta — ej: Fotos, Tarjetas, Stickers"
            className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
          />
          <datalist id="save-template-categorias">
            {existingCategories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}
