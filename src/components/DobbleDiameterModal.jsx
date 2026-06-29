import { useEffect, useRef, useState } from 'react';

// Editor de mazo Dobble: SOLO el diámetro. Al aplicar, App re-renderiza las
// cartas al nuevo tamaño físico (los placements son lossless) y recalcula grilla
// y cortes. El resto de la geometría queda oculto a propósito (la define la receta).
export default function DobbleDiameterModal({
  open,
  diametroMM = 65,
  doubleSided = false,
  busy = false,
  onSubmit,
  onCancel,
}) {
  const [text, setText] = useState(String(diametroMM));
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setText(String(diametroMM));
      const t = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, diametroMM]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const parsed = parseFloat(String(text).replace(',', '.'));
  const valido = Number.isFinite(parsed) && parsed >= 10 && parsed <= 200;

  const submit = (e) => {
    e?.preventDefault();
    if (!valido || busy) return;
    onSubmit?.(Math.round(parsed * 10) / 10);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-[22rem] max-w-[95vw] rounded-lg border border-ink-700 bg-ink-900 shadow-2xl"
      >
        <div className="border-b border-ink-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-ink-100">Editar mazo Dobble</h3>
          <p className="mt-1 text-xs text-ink-400">
            Cambiá el diámetro de la carta. Se vuelven a generar las cartas a ese
            tamaño, la grilla y los cortes{doubleSided ? ' (doble faz)' : ''}.
          </p>
        </div>
        <div className="px-4 py-4">
          <label className="block text-xs text-ink-300">
            <span className="mb-1 block">Diámetro de la carta (mm)</span>
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
            />
          </label>
          {!valido && text !== '' && (
            <p className="mt-1 text-[11px] text-amber-300">Poné un diámetro entre 10 y 200 mm.</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-ink-700 px-4 py-3">
          <button
            type="button"
            onClick={() => onCancel?.()}
            disabled={busy}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!valido || busy}
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            {busy ? 'Generando…' : 'Aplicar'}
          </button>
        </div>
      </form>
    </div>
  );
}
