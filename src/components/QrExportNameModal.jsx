import { useEffect, useState } from 'react';

// Mini-diálogo para nombrar el corte antes de guardarlo en la carpeta QR.
// (window.prompt no está soportado en Electron.) El nombre se usa para el QR,
// el .plt y el .pdf, así que se sanea a caracteres QR/filesystem-safe.
export default function QrExportNameModal({ open, proposedName, onConfirm, onCancel }) {
  const [name, setName] = useState('');

  useEffect(() => {
    if (open) setName(proposedName || '');
  }, [open, proposedName]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const sanitized = String(name).trim().replace(/[^A-Za-z0-9_-]/g, '');
  const submit = (e) => {
    e?.preventDefault();
    if (sanitized) onConfirm?.(sanitized);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-[26rem] max-w-[92vw] rounded-lg border border-ink-700 bg-ink-900 p-4 shadow-2xl"
      >
        <h3 className="text-sm font-semibold text-ink-100">Nombre del corte</h3>
        <p className="mt-1 text-xs text-ink-400">
          Se usa para el QR de la hoja, el archivo <b>.plt</b> y el <b>.pdf</b>. Sólo
          letras, números, guión y guión bajo (sin espacios ni acentos).
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-3 w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
        />
        <p className="mt-1 text-[11px] text-ink-500">
          Se guardará como <b className="text-ink-300">{sanitized || '—'}.plt</b> y{' '}
          <b className="text-ink-300">{sanitized || '—'}.pdf</b>
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onCancel?.()}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!sanitized}
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            Guardar corte
          </button>
        </div>
      </form>
    </div>
  );
}
