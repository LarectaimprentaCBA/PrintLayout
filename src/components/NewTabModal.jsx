import { useEffect, useMemo, useState } from 'react';
import { describeCells, hasCuts } from '../lib/templates.js';
import { PLANCHA_LIST } from '../rotulos/planchas.js';

const SIN_CARPETA = 'General';
const TODAS = '__todas__';
const SELECTED_KEY = 'printlayout.newTabModal.selectedCarpeta';

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
  onDeleteSharedTemplate,
  canShare = false,
  onPickTemplate,
  isLaRecta = false,
  onToggleOficial,
  onCreateGrid,
  onAutoPack,
  onCountPack,
  onUploadPdf,
  onOpenJobsList,
  onImportDobble,
  onCreateRotulos,
  onClose,
}) {
  const [view, setView] = useState('main'); // 'main' | 'templates' | 'rotulos'
  const [query, setQuery] = useState('');
  // Sub-vista Rótulos: plancha elegida + buscador de modelo.
  const [rotPlancha, setRotPlancha] = useState(PLANCHA_LIST[0]?.id || 'plancha1');
  const [rotModels, setRotModels] = useState([]);
  const [rotQuery, setRotQuery] = useState('');
  const [rotModelId, setRotModelId] = useState('');
  const [selectedCarpeta, setSelectedCarpeta] = useState(() => {
    try {
      return localStorage.getItem(SELECTED_KEY) || TODAS;
    } catch {
      return TODAS;
    }
  });

  const pickCarpeta = (cat) => {
    setSelectedCarpeta(cat);
    try { localStorage.setItem(SELECTED_KEY, cat); } catch {}
  };

  useEffect(() => {
    if (!open) {
      setView('main');
      setQuery('');
      setRotQuery('');
      setRotModelId('');
    }
  }, [open]);

  // Cargar los modelos de rótulos al entrar a la sub-vista.
  useEffect(() => {
    if (!open || view !== 'rotulos') return;
    let cancelled = false;
    (async () => {
      try {
        const m = await window.printlayout?.rotulos?.modelsList?.();
        if (!cancelled) setRotModels(Array.isArray(m) ? m : []);
      } catch { if (!cancelled) setRotModels([]); }
    })();
    return () => { cancelled = true; };
  }, [open, view]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (view !== 'main') setView('main');
        else onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, view, onClose]);

  // Lista de carpetas (incluye "Todas" siempre primero). Cada una con count
  // total (sin filtro de query — el conteo es el universo, no la vista).
  const carpetas = useMemo(() => {
    const counts = new Map();
    for (const t of templates) {
      const cat = (t.categoria || '').trim() || SIN_CARPETA;
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    const keys = Array.from(counts.keys()).sort((a, b) => {
      if (a === SIN_CARPETA) return 1;
      if (b === SIN_CARPETA) return -1;
      return a.localeCompare(b);
    });
    return [
      { id: TODAS, label: 'Todas', count: templates.length },
      ...keys.map((k) => ({ id: k, label: k, count: counts.get(k) })),
    ];
  }, [templates]);

  // Plantillas visibles en el pane derecho: filtradas por query (si hay) y
  // por carpeta seleccionada (excepto si query, donde mostramos todas las
  // matcheadas para no esconder coincidencias).
  const visibleTemplates = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = templates;
    if (!q && selectedCarpeta !== TODAS) {
      list = list.filter((t) => {
        const cat = (t.categoria || '').trim() || SIN_CARPETA;
        return cat === selectedCarpeta;
      });
    }
    if (q) {
      list = list.filter((t) =>
        `${t.name || ''} ${t.categoria || ''}`.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [templates, query, selectedCarpeta]);
  const hasQuery = query.trim() !== '';

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
            {view !== 'main' && (
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
              {view === 'templates' ? 'Elegir plantilla' : view === 'rotulos' ? 'Rótulos escolares' : 'Nuevo trabajo'}
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
              title="Abrir trabajo desde archivo"
              subtitle="Buscar un .pljob guardado (cliente, fecha, etc.)"
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M3 7 H10 L12 5 H21 V19 H3 Z" strokeLinejoin="round" />
                </svg>
              )}
              onClick={handleOption(onOpenJobsList)}
            />
            {onImportDobble && (
              <OptionCard
                title="Importar mazo Dobble"
                subtitle="Abrir un mazo (.json) y posarlo sobre una plantilla redonda"
                icon={(
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <circle cx="9" cy="9" r="5" />
                    <circle cx="15" cy="15" r="5" />
                  </svg>
                )}
                onClick={handleOption(onImportDobble)}
              />
            )}
            {onCreateRotulos && (
              <OptionCard
                title="Rótulos escolares"
                subtitle="Plancha de etiquetas con nombre (elegí plancha + modelo)"
                icon={(
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <rect x="3" y="5" width="18" height="5" rx="1.2" />
                    <rect x="3" y="14" width="8" height="5" rx="1.2" />
                    <rect x="13" y="14" width="8" height="5" rx="1.2" />
                  </svg>
                )}
                onClick={() => setView('rotulos')}
              />
            )}
          </div>
        ) : view === 'rotulos' ? (
          <div className="flex flex-col gap-4 p-4">
            <label className="text-xs text-ink-300">
              <span className="mb-1 block">Tipo de plancha</span>
              <select
                value={rotPlancha}
                onChange={(e) => setRotPlancha(e.target.value)}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              >
                {PLANCHA_LIST.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>

            <div className="text-xs text-ink-300">
              <span className="mb-1 block">Número de modelo</span>
              <input
                value={rotQuery}
                onChange={(e) => { setRotQuery(e.target.value); setRotModelId(''); }}
                placeholder="Escribí el número o nombre del modelo…"
                className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                autoFocus
              />
              <div className="mt-2 max-h-56 overflow-y-auto rounded border border-ink-800">
                {rotModels.length === 0 ? (
                  <p className="px-3 py-6 text-center text-[11px] text-ink-500">No hay modelos cargados. Cargá uno en “Rótulos → Modelos”.</p>
                ) : (
                  rotModels
                    .filter((m) => {
                      const q = rotQuery.trim().toLowerCase();
                      return !q || String(m.nombre || '').toLowerCase().includes(q);
                    })
                    .map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => { setRotModelId(m.id); setRotQuery(m.nombre || ''); }}
                        className={`flex w-full items-center gap-3 border-b border-ink-800 px-3 py-2 text-left last:border-b-0 hover:bg-ink-800 ${rotModelId === m.id ? 'bg-accent-600/20' : ''}`}
                      >
                        {m.thumb
                          ? <img src={m.thumb} alt="" className="h-8 w-12 shrink-0 rounded object-cover" />
                          : <div className="h-8 w-12 shrink-0 rounded bg-ink-800" />}
                        <span className="text-sm text-ink-100">{m.nombre || '(sin nombre)'}</span>
                        {rotModelId === m.id && <span className="ml-auto text-[11px] text-accent-300">✓ elegido</span>}
                      </button>
                    ))
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setView('main')}
                className="rounded border border-ink-700 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800"
              >
                Volver
              </button>
              <button
                type="button"
                disabled={!rotPlancha || !rotModelId}
                onClick={() => onCreateRotulos?.({ planchaId: rotPlancha, modeloId: rotModelId })}
                className="rounded bg-accent-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
              >
                Continuar
              </button>
            </div>
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
            <div className="flex flex-1 overflow-hidden">
              {/* Pane izquierdo: carpetas. */}
              <div className="w-44 shrink-0 overflow-y-auto border-r border-ink-700 py-2">
                <ul className="space-y-0.5 px-1">
                  {carpetas.map((c) => {
                    const isActive = !hasQuery && c.id === selectedCarpeta;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => pickCarpeta(c.id)}
                          className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs ${
                            isActive
                              ? 'bg-accent-600/20 text-accent-200'
                              : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
                          }`}
                        >
                          <span className="truncate">{c.label}</span>
                          <span className="ml-1 shrink-0 text-[10px] text-ink-500">{c.count}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {/* Pane derecho: plantillas de la carpeta seleccionada (o todas si hay query). */}
              <div className="flex-1 overflow-y-auto px-3 py-2">
                {visibleTemplates.length === 0 ? (
                  <p className="px-3 py-8 text-center text-xs text-ink-400">
                    {templates.length === 0
                      ? 'Todavia no hay plantillas. Subi un PDF desde "Nuevo trabajo".'
                      : hasQuery
                        ? 'No hay plantillas que coincidan.'
                        : 'Esta carpeta esta vacia.'}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {visibleTemplates.map((t) => (
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
                              {t.oficial && (
                                <span
                                  className="shrink-0 rounded bg-amber-500/20 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-300"
                                  title="Plancha oficial (alimenta la web/CRM)"
                                >
                                  oficial
                                </span>
                              )}
                              {t.sharedAt && (
                                <span className="shrink-0 text-accent-400" title="Compartida con el equipo">☁</span>
                              )}
                            </div>
                            <div className="mt-0.5 text-[11px] text-ink-400">
                              {hasQuery && t.categoria ? `${t.categoria} · ` : ''}
                              {describeCells(t)}
                              {hasCuts(t) && (
                                <span className="ml-2 text-accent-400">corte</span>
                              )}
                              {' · '}
                              {Math.round(t.pageWidthMm)}×{Math.round(t.pageHeightMm)} mm
                            </div>
                          </button>
                          {isLaRecta && onToggleOficial && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onToggleOficial(t); }}
                              className={`shrink-0 rounded border px-2 py-1 text-[11px] opacity-0 transition group-hover:opacity-100 ${
                                t.oficial
                                  ? 'border-amber-500/40 text-amber-300 hover:bg-amber-500/15'
                                  : 'border-ink-600 text-ink-300 hover:bg-ink-700'
                              }`}
                              title={t.oficial ? 'Quitar de oficiales (deja de alimentar la web)' : 'Marcar como oficial (alimenta la web/CRM)'}
                            >
                              {t.oficial ? 'Quitar oficial' : 'Marcar oficial'}
                            </button>
                          )}
                          {/* Borrar: bloqueado para oficiales salvo modo La Recta.
                              Si la plantilla es compartida y esta PC puede
                              escribir el repo, el borrado es REAL (todas las PCs). */}
                          {(!t.oficial || isLaRecta) && t.sharedAt && canShare && onDeleteSharedTemplate ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(
                                  `¿Borrar "${t.name}" de TODAS las PCs?\n\n`
                                  + 'Se quita del repositorio compartido y desaparece en todas '
                                  + 'las computadoras del taller (cuando cada una sincronice).\n\n'
                                  + 'Esto NO se puede deshacer.',
                                )) onDeleteSharedTemplate(t.id);
                              }}
                              className="shrink-0 rounded border border-red-500/40 px-2 py-1 text-[11px] text-red-300 opacity-0 transition hover:bg-red-500/15 group-hover:opacity-100"
                              title="Borrar del repositorio compartido (todas las PCs)"
                            >
                              Borrar de todas
                            </button>
                          ) : onDeleteTemplate && (!t.oficial || isLaRecta) && (
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
                          {t.oficial && !isLaRecta && (
                            <span
                              className="shrink-0 text-[10px] text-ink-500"
                              title="Plancha oficial: solo La Recta puede editarla o borrarla"
                            >
                              🔒
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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
