// Modal de confirmacion generico con N acciones. No es un input — solo botones.
// Props:
//   - open: boolean
//   - title: string
//   - message?: string (descripcion debajo del titulo)
//   - actions: Array<{ label: string, value: any, variant?: 'primary' | 'default' | 'danger' }>
//   - onAction: (value) => void (se llama al click de cualquier accion)
//   - onCancel: () => void (se llama al click en backdrop o Escape)
//   - cancelLabel?: string (default 'Cancelar'; agrega boton extra al inicio)
//
// Convencion: el ultimo boton de actions es el confirmativo (variant 'primary'),
// pero no es obligatorio — el caller arma las acciones como quiera.
import { useEffect } from 'react';

const VARIANT_CLASSES = {
  primary: 'bg-accent-600 text-white hover:bg-accent-500',
  default: 'border border-ink-700 text-ink-100 hover:bg-ink-800',
  danger: 'bg-red-600 text-white hover:bg-red-500',
};

export default function ConfirmModal({
  open,
  title,
  message,
  actions = [],
  cancelLabel = 'Cancelar',
  onAction,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div className="w-96 rounded-lg border border-ink-700 bg-ink-900 p-4 shadow-2xl">
        <h3 className="text-sm font-semibold text-ink-100">{title}</h3>
        {message && <p className="mt-1 text-xs text-ink-400">{message}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {cancelLabel && (
            <button
              type="button"
              onClick={() => onCancel?.()}
              className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
            >
              {cancelLabel}
            </button>
          )}
          {actions.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onAction?.(a.value)}
              className={`rounded px-3 py-1 text-xs font-medium ${
                VARIANT_CLASSES[a.variant] ?? VARIANT_CLASSES.default
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
