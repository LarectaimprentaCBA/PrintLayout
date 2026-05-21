import { useEffect, useRef, useState } from 'react';

// Modal para guardar el trabajo en curso como un job nombrado.
// defaultName: si el trabajo ya tiene nombre (re-save desde otro), prellenado.
export default function SaveJobModal({
  open,
  defaultName = '',
  onConfirm,
  onCancel,
}) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setName(defaultName || '');
    setTimeout(() => inputRef.current?.select(), 0);
  }, [open, defaultName]);

  if (!open) return null;

  const submit = (e) => {
    e?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm?.({ name: trimmed });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
    >
      <form
        onSubmit={submit}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel?.(); }}
        className="w-96 rounded-lg border border-ink-700 bg-ink-900 p-4 shadow-2xl"
      >
        <h3 className="text-sm font-semibold text-ink-100">Guardar trabajo</h3>
        <p className="mt-1 text-[11px] text-ink-400">
          El trabajo se guarda con plantilla, imagenes y asignaciones. Vas a
          poder reabrirlo desde "Abrir trabajo".
        </p>

        <label className="mt-4 block text-xs text-ink-300">
          <span className="mb-1 block">Nombre</span>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Tarjetas Juan 2026-05"
            className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
          />
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
