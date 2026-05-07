import { useEffect, useRef, useState } from 'react';

export default function PromptModal({
  open,
  title,
  message,
  defaultValue = '',
  placeholder,
  confirmLabel = 'Aceptar',
  cancelLabel = 'Cancelar',
  onConfirm,
  onCancel,
}) {
  const [value, setValue] = useState(String(defaultValue));
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setValue(String(defaultValue));
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [open, defaultValue]);

  if (!open) return null;

  const submit = (e) => {
    e?.preventDefault();
    onConfirm?.(value);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <form
        onSubmit={submit}
        className="w-80 rounded-lg border border-ink-700 bg-ink-900 p-4 shadow-2xl"
      >
        <h3 className="text-sm font-semibold text-ink-100">{title}</h3>
        {message && (
          <p className="mt-1 text-xs text-ink-400">{message}</p>
        )}
        <input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel?.();
          }}
          placeholder={placeholder}
          className="mt-3 w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onCancel?.()}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
