import { useRef } from 'react';
import { describeCells, hasCuts } from '../lib/templates.js';

export default function TemplatesSidebar({
  templates,
  selectedId,
  uploading,
  syncing,
  onSelect,
  onUploadPdf,
  onDelete,
  onSync,
}) {
  const fileRef = useRef(null);

  const handlePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onUploadPdf?.(file);
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-ink-700 bg-ink-900">
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={handlePick}
      />
      <div className="flex items-center justify-between gap-1 border-b border-ink-700 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-300">
          Plantillas
        </h2>
        <div className="flex gap-1">
          {onSync && (
            <button
              onClick={onSync}
              disabled={syncing}
              className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-40"
              title="Pullear plantillas compartidas desde el repo"
            >
              {syncing ? '…' : '↻'}
            </button>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="rounded bg-accent-600 px-2 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
            title="Subir un PDF de plantilla (3 páginas: imprimible, celdas, cortes)"
          >
            {uploading ? 'Cargando…' : '+ Subir PDF'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {templates.length === 0 ? (
          <p className="px-2 py-3 text-xs text-ink-400">
            No hay plantillas. Subí un PDF con las páginas:
            <span className="mt-2 block text-ink-500">
              1 — imprimible
              <br />
              2 — cajas de posicionado
              <br />
              3 — vectores de corte (opcional)
            </span>
          </p>
        ) : (
          <ul className="space-y-2">
            {templates.map((t) => {
              const selected = t.id === selectedId;
              return (
                <li key={t.id}>
                  <div
                    className={`group cursor-pointer rounded-md border p-2 transition ${
                      selected
                        ? 'border-accent-500 bg-ink-800'
                        : 'border-ink-700 bg-ink-900 hover:border-ink-500 hover:bg-ink-800'
                    }`}
                    onClick={() => onSelect(t.id)}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-ink-100">
                        <span className="truncate">{t.name}</span>
                        {t.sharedAt && (
                          <span
                            className="shrink-0 text-accent-400"
                            title="Plantilla compartida con el equipo"
                          >
                            ☁
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-400">
                        {describeCells(t)}
                        {hasCuts(t) && (
                          <span className="ml-2 text-accent-400">corte</span>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-500">
                        {Math.round(t.pageWidthMm)}×{Math.round(t.pageHeightMm)} mm
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end opacity-0 transition group-hover:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`¿Eliminar la plantilla "${t.name}"?`)) onDelete(t.id);
                        }}
                        className="rounded px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-500/10"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
