import { useEffect, useMemo, useState } from 'react';
import { describeCells, hasCuts } from '../lib/templates.js';

// Modal "Nuevo trabajo" — hub central para empezar un trabajo nuevo. Tiene
// dos vistas:
//   - main: grilla de 6 opciones grandes (plantilla / grilla / auto /
//     cantidad / PDF / abrir trabajo).
//   - templates: sub-lista buscable con las plantillas guardadas. Click =
//     abre la plantilla en tab y cierra el modal.
//
// Cada opcion cierra el modal y delega al caller. Los flujos que requieren
// file picker (Auto, Cantidad, PDF) los maneja App.jsx con inputs hidden.
export default function NewTabModal({
  open,
  templates = [],
  syncing = false,
  onSync,
  onDeleteTemplate,
  onPickTemplate,
  onCreateGrid,
  onAutoPack,
  onCountPack,
  onUploadPdf,
  onOpenJobsList,
  onClose,
}) {
  const [view, setView] = useState('main'); // 'main' | 'templates'
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) {
      setView('main');
      setQuery('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (view === 'templates') setView('main');
        else onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, view, onClose]);

  const filteredTemplates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...templates].sort((a, b) => {
      const ca = (a.categoria || '').localeCompare(b.categoria || '');
      if (ca !== 0) return ca;
      return (a.name || '').localeCompare(b.name || '');
    });
    if (!q) return sorted;
    return sorted.filter((t) =>
      `${t.name || ''} ${t.categoria || ''}`.toLowerCase().includes(q),
    );
  }, [templates, query]);

  if (!open) return null;

  const handleOption = (fn) => () => {
    onClose?.();
    fn?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="flex max-h-[85vh] w-[640px] max-w-[95vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <div className="flex items-center gap-2">
            {view === 'templates' && (
              <button
                type="button"
                onClick={() => setView('main')}
                className="rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100"
                title="Volver"
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" stroke="currentColor" strokeWidth="1.75" fill="none">
                  <path d="M10 3 L5 8 L10 13" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            <h3 className="text-sm font-semibold text-ink-100">
              {view === 'templates' ? 'Elegir plantilla' : 'Nuevo trabajo'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-ink-100"
            title="Cerrar (Esc)"
          >
            ✕
          </button>
        </div>

        {view === 'main' ? (
          <div className="grid grid-cols-2 gap-3 p-4">
            <OptionCard
              title="Plantilla existente"
              subtitle={templates.length === 0
                ? 'Todavia no hay plantillas guardadas'
                : `${templates.length} plantilla${templates.length === 1 ? '' : 's'} guardada${templates.length === 1 ? '' : 's'}`}
              disabled={templates.length === 0}
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <rect x="4" y="3" width="16" height="18" rx="2" />
                  <path d="M8 8 H16 M8 12 H16 M8 16 H13" strokeLinecap="round" />
                </svg>
              )}
              onClick={() => setView('templates')}
            />
            <OptionCard
              title="Grilla rapida"
              subtitle="Filas x columnas con tamano de hoja libre"
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <rect x="3" y="3" width="8" height="8" rx="1" />
                  <rect x="13" y="3" width="8" height="8" rx="1" />
                  <rect x="3" y="13" width="8" height="8" rx="1" />
                  <rect x="13" y="13" width="8" height="8" rx="1" />
                </svg>
              )}
              onClick={handleOption(onCreateGrid)}
            />
            <OptionCard
              title="Acomodar por tamano"
              subtitle="Subis imagenes y fijas alto o ancho en mm"
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M4 7 L20 7 M4 12 L20 12 M4 17 L20 17" strokeLinecap="round" />
                  <path d="M4 4 L4 20 M20 4 L20 20" strokeLinecap="round" />
                </svg>
              )}
              onClick={handleOption(onAutoPack)}
            />
            <OptionCard
              title="Acomodar por cantidad"
              subtitle="N copias por hoja al maximo tamano posible"
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <text x="12" y="16" textAnchor="middle" fontSize="11" fill="currentColor" stroke="none">N</text>
                  <rect x="3" y="4" width="18" height="16" rx="1.5" />
                </svg>
              )}
              onClick={handleOption(onCountPack)}
            />
            <OptionCard
              title="Subir PDF de plantilla"
              subtitle="PDF con paginas de marcas / cajas / cortes"
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M6 3 H14 L19 8 V21 H6 Z" strokeLinejoin="round" />
                  <path d="M14 3 V8 H19" strokeLinejoin="round" />
                  <path d="M12 12 V18 M9 15 L12 18 L15 15" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              onClick={handleOption(onUploadPdf)}
            />
            <OptionCard
              title="Abrir trabajo guardado"
              subtitle="Reabrir uno de los trabajos persistidos"
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M3 7 H10 L12 5 H21 V19 H3 Z" strokeLinejoin="round" />
                </svg>
              )}
              onClick={handleOption(onOpenJobsList)}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-ink-700 px-4 py-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar plantilla por nombre o carpeta…"
                className="flex-1 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                autoFocus
              />
              {onSync && (
                <button
                  type="button"
                  onClick={onSync}
                  disabled={syncing}
                  className="rounded border border-ink-700 px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-40"
                  title="Pullear plantillas compartidas desde el repo"
                >
                  {syncing ? '…' : '↻'}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {filteredTemplates.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs text-ink-400">
                  {templates.length === 0
                    ? 'Todavia no hay plantillas. Subi un PDF desde "Nuevo trabajo".'
                    : 'No hay plantillas que coincidan.'}
                </p>
              ) : (
                <ul className="space-y-1">
                  {filteredTemplates.map((t) => (
                    <li key={t.id}>
                      <div className="group flex items-center gap-3 rounded-md border border-transparent px-3 py-2 hover:border-ink-700 hover:bg-ink-800">
                        <button
                          type="button"
                          onClick={() => {
                            onClose?.();
                            onPickTemplate?.(t.id);
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center gap-1.5 truncate text-sm font-medium text-ink-100">
                            <span className="truncate">{t.name}</span>
                            {t.sharedAt && (
                              <span className="shrink-0 text-accent-400" title="Compartida con el equipo">☁</span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[11px] text-ink-400">
                            {t.categoria ? `${t.categoria} · ` : ''}
                            {describeCells(t)}
                            {hasCuts(t) && (
                              <span className="ml-2 text-accent-400">corte</span>
                            )}
                            {' · '}
                            {Math.round(t.pageWidthMm)}×{Math.round(t.pageHeightMm)} mm
                          </div>
                        </button>
                        {onDeleteTemplate && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`¿Eliminar la plantilla "${t.name}"?`)) {
                                onDeleteTemplate(t.id);
                              }
                            }}
                            className="shrink-0 rounded border border-red-500/40 px-2 py-1 text-[11px] text-red-300 opacity-0 transition hover:bg-red-500/15 group-hover:opacity-100"
                            title="Eliminar plantilla"
                          >
                            Eliminar
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        <div className="flex justify-end border-t border-ink-700 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function OptionCard({ title, subtitle, icon, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group flex h-full items-start gap-3 rounded-lg border p-4 text-left transition ${
        disabled
          ? 'cursor-not-allowed border-ink-800 bg-ink-900/40 opacity-50'
          : 'border-ink-700 bg-ink-800/60 hover:border-accent-500/60 hover:bg-ink-800'
      }`}
    >
      <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
        disabled ? 'bg-ink-800 text-ink-500' : 'bg-ink-900 text-accent-400 group-hover:text-accent-300'
      }`}>
        <span className="h-5 w-5">{icon}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink-100">{title}</span>
        <span className="mt-0.5 block text-[11px] text-ink-400">{subtitle}</span>
      </span>
    </button>
  );
}
