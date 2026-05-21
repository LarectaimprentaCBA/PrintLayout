import { useEffect, useMemo, useState } from 'react';

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yy} ${hh}:${mi}`;
  } catch {
    return '';
  }
}

function fmtMm(n) {
  if (!Number.isFinite(n)) return '?';
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// Modal para listar trabajos guardados y elegir uno para abrir / eliminar.
// jobs: metadata light (sin imagenes); onOpen recibe el id.
export default function JobsListModal({
  open,
  jobs = [],
  loading = false,
  onOpen,
  onDelete,
  onClose,
}) {
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setConfirmDelete(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (confirmDelete) setConfirmDelete(null);
        else onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, confirmDelete, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) => (j.name || '').toLowerCase().includes(q));
  }, [jobs, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="flex h-[80vh] w-[720px] max-w-[95vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-ink-100">Abrir trabajo</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-ink-100"
            title="Cerrar (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="border-b border-ink-700 px-4 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre…"
            className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading ? (
            <p className="px-3 py-8 text-center text-xs text-ink-400">Cargando…</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-ink-400">
              {jobs.length === 0
                ? 'Todavia no hay trabajos guardados. Usá "Guardar trabajo" en la barra superior.'
                : 'No hay trabajos que coincidan con la busqueda.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((j) => (
                <li
                  key={j.id}
                  className="group flex items-center gap-3 rounded-md border border-transparent px-3 py-2 hover:border-ink-700 hover:bg-ink-800"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink-100">
                      {j.name || 'Sin nombre'}
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-400">
                      {formatDate(j.updatedAt)}
                      {j.templateName ? ` · ${j.templateName}` : ''}
                      {Number.isFinite(j.pageWidthMm) && Number.isFinite(j.pageHeightMm)
                        ? ` · ${fmtMm(j.pageWidthMm)}×${fmtMm(j.pageHeightMm)} mm`
                        : ''}
                      {' · '}
                      {j.imageCount} imagen{j.imageCount === 1 ? '' : 'es'}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(j)}
                      className="rounded border border-red-500/40 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/15"
                      title="Eliminar trabajo"
                    >
                      Eliminar
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpen?.(j.id)}
                      className="rounded bg-accent-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-500"
                    >
                      Abrir
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-ink-700 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
          >
            Cerrar
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null); }}
        >
          <div className="w-96 rounded-lg border border-ink-700 bg-ink-900 p-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-ink-100">
              Eliminar trabajo
            </h3>
            <p className="mt-1 text-xs text-ink-400">
              Vas a borrar "{confirmDelete.name}". Esta accion no se puede deshacer.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = confirmDelete.id;
                  setConfirmDelete(null);
                  onDelete?.(id);
                }}
                className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
