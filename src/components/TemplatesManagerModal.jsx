import { useEffect, useMemo, useState } from 'react';
import { describeCells, hasCuts } from '../lib/templates.js';

const SIN_CARPETA = 'General';
const TODAS = '__todas__';

// Editor de plantillas: una sección propia para VER y ADMINISTRAR las plantillas
// sin pasar por "Nuevo trabajo". Lista en texto (compacta), agrupada por carpeta,
// con acciones por fila: editar nombre/carpeta, editar medidas, duplicar,
// marcar/quitar oficial (solo La Recta), eliminar y abrir en una pestaña.
//
// El modal NO persiste nada por su cuenta: delega en callbacks (onSaveDetails,
// onDuplicate, onDelete, onToggleOficial, onEditGeometry, onOpenInTab) que App
// resuelve contra el store de plantillas.
export default function TemplatesManagerModal({
  open,
  templates = [],
  categorias = [],
  isLaRecta = false,
  onSaveDetails,
  onDuplicate,
  onDelete,
  onToggleOficial,
  onEditGeometry,
  onOpenInTab,
  onRenameCategoria,
  onClose,
}) {
  const [query, setQuery] = useState('');
  const [selectedCarpeta, setSelectedCarpeta] = useState(TODAS);
  // Edición inline de nombre + carpeta de una fila.
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editCat, setEditCat] = useState('');
  const [editCatalogoId, setEditCatalogoId] = useState('');
  // Renombrar carpeta (mueve todas sus plantillas).
  const [editingFolder, setEditingFolder] = useState(null);
  const [folderDraft, setFolderDraft] = useState('');

  useEffect(() => {
    if (!open) {
      setQuery('');
      setEditingId(null);
      setEditingFolder(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (editingId) setEditingId(null);
        else onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, editingId, onClose]);

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

  const startEdit = (t) => {
    setEditingId(t.id);
    setEditName(t.name || '');
    setEditCat(t.categoria || '');
    setEditCatalogoId(t.catalogoId || '');
  };

  const saveEdit = (t) => {
    const name = editName.trim();
    if (!name) return;
    const payload = { name, categoria: editCat.trim() };
    // El id de catálogo solo se edita en plantillas oficiales y en modo La Recta.
    if (t.oficial && isLaRecta) payload.catalogoId = editCatalogoId.trim();
    onSaveDetails?.(t, payload);
    setEditingId(null);
  };

  const startRenameFolder = (c) => {
    setEditingFolder(c.id);
    setFolderDraft(c.label);
  };
  const commitRenameFolder = (c) => {
    const to = folderDraft.trim();
    setEditingFolder(null);
    if (!to || to === c.label) return;
    onRenameCategoria?.(c.id, to);
    if (selectedCarpeta === c.id) setSelectedCarpeta(to);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="flex max-h-[88vh] w-[820px] max-w-[96vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-ink-100">Plantillas</h3>
            <p className="text-[11px] text-ink-400">
              {templates.length} plantilla{templates.length === 1 ? '' : 's'} guardada{templates.length === 1 ? '' : 's'}
              {' · '}ver, editar medidas, organizar
            </p>
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

        {/* Buscador */}
        <div className="border-b border-ink-700 px-4 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o carpeta…"
            className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
            autoFocus
          />
          <datalist id="tpl-manager-categorias">
            {categorias.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Carpetas */}
          <div className="flex w-48 shrink-0 flex-col border-r border-ink-700">
            <ul className="flex-1 space-y-0.5 overflow-y-auto px-1 py-2">
              {carpetas.map((c) => {
                const isActive = !hasQuery && c.id === selectedCarpeta;
                const renamable = onRenameCategoria && c.id !== TODAS && c.id !== SIN_CARPETA;
                if (editingFolder === c.id) {
                  return (
                    <li key={c.id} className="flex items-center gap-1 px-1">
                      <input
                        value={folderDraft}
                        autoFocus
                        onChange={(e) => setFolderDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRenameFolder(c);
                          if (e.key === 'Escape') setEditingFolder(null);
                        }}
                        className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-800 px-1.5 py-1 text-xs text-ink-100 outline-none focus:border-accent-500"
                      />
                      <button
                        type="button"
                        onClick={() => commitRenameFolder(c)}
                        title="Guardar"
                        className="shrink-0 rounded px-1 text-accent-300 hover:bg-ink-700"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingFolder(null)}
                        title="Cancelar"
                        className="shrink-0 rounded px-1 text-ink-400 hover:bg-ink-700"
                      >
                        ✕
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={c.id} className="group/folder flex items-center">
                    <button
                      type="button"
                      onClick={() => setSelectedCarpeta(c.id)}
                      className={`flex min-w-0 flex-1 items-center justify-between rounded px-2 py-1.5 text-left text-xs ${
                        isActive
                          ? 'bg-accent-600/20 text-accent-200'
                          : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
                      }`}
                    >
                      <span className="truncate">{c.label}</span>
                      <span className="ml-1 shrink-0 text-[10px] text-ink-500">{c.count}</span>
                    </button>
                    {renamable && (
                      <button
                        type="button"
                        onClick={() => startRenameFolder(c)}
                        title="Renombrar carpeta (mueve todas sus plantillas)"
                        className="shrink-0 px-1 text-ink-500 opacity-0 transition hover:text-accent-300 group-hover/folder:opacity-100"
                      >
                        ✎
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-ink-700 px-2 py-2 text-[10px] leading-snug text-ink-500">
              Para crear una carpeta nueva, editá una plantilla y escribí el nombre en “Carpeta”.
            </p>
          </div>

          {/* Listado */}
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {visibleTemplates.length === 0 ? (
              <p className="px-3 py-10 text-center text-xs text-ink-400">
                {templates.length === 0
                  ? 'Todavía no hay plantillas guardadas.'
                  : hasQuery
                    ? 'No hay plantillas que coincidan.'
                    : 'Esta carpeta está vacía.'}
              </p>
            ) : (
              <ul className="space-y-1">
                {visibleTemplates.map((t) => {
                  const locked = t.oficial && !isLaRecta; // oficial read-only fuera de La Recta
                  const isPdf = !!t.pdfBase64;
                  const editing = editingId === t.id;
                  return (
                    <li
                      key={t.id}
                      className="rounded-md border border-transparent px-3 py-2 hover:border-ink-700 hover:bg-ink-800/60"
                    >
                      {editing ? (
                        <div className="space-y-2">
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <label className="flex-1 text-[11px] text-ink-400">
                              <span className="mb-0.5 block">Nombre</span>
                              <input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(t); }}
                                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
                              />
                            </label>
                            <label className="flex-1 text-[11px] text-ink-400">
                              <span className="mb-0.5 block">Carpeta</span>
                              <input
                                list="tpl-manager-categorias"
                                value={editCat}
                                onChange={(e) => setEditCat(e.target.value)}
                                placeholder="Sin carpeta — o escribí una nueva"
                                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(t); }}
                                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
                              />
                              <span className="mt-0.5 block text-[10px] text-ink-500">
                                Elegí una existente o escribí un nombre nuevo para crear la carpeta.
                              </span>
                            </label>
                          </div>
                          {t.oficial && isLaRecta && (
                            <label className="block text-[11px] text-ink-400">
                              <span className="mb-0.5 block">ID de catálogo (enganche con la web/CRM)</span>
                              <input
                                value={editCatalogoId}
                                onChange={(e) => setEditCatalogoId(e.target.value)}
                                placeholder="polaroid"
                                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(t); }}
                                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm font-mono text-ink-100 outline-none focus:border-accent-500"
                              />
                              <span className="mt-0.5 block text-[10px] text-amber-400/80">
                                Cambiarlo re-publica el catálogo. Mantenelo igual al de la web.
                              </span>
                            </label>
                          )}
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded border border-ink-700 px-2.5 py-1 text-[11px] text-ink-200 hover:bg-ink-800"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={() => saveEdit(t)}
                              disabled={!editName.trim()}
                              className="rounded bg-accent-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-500 disabled:opacity-40"
                            >
                              Guardar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
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
                              {t.oficial && t.catalogoId && (
                                <span
                                  className="shrink-0 rounded bg-ink-700 px-1 font-mono text-[9px] text-ink-200"
                                  title="ID de catálogo (enganche con la web/CRM)"
                                >
                                  {t.catalogoId}
                                </span>
                              )}
                              {t.sharedAt && (
                                <span className="shrink-0 text-accent-400" title="Compartida con el equipo">☁</span>
                              )}
                              {locked && (
                                <span className="shrink-0 text-[10px] text-ink-500" title="Oficial: solo La Recta puede editarla o borrarla">🔒</span>
                              )}
                            </div>
                            <div className="mt-0.5 text-[11px] text-ink-400">
                              {(t.categoria || '').trim() ? `${t.categoria} · ` : ''}
                              {describeCells(t)}
                              {hasCuts(t) && <span className="ml-1 text-accent-400">· corte</span>}
                              {t.doubleSided && <span className="ml-1 text-ink-300">· doble faz</span>}
                              {isPdf && <span className="ml-1 text-ink-300">· PDF</span>}
                              {' · '}
                              {Math.round(t.pageWidthMm)}×{Math.round(t.pageHeightMm)} mm
                            </div>
                          </div>

                          {/* Acciones */}
                          <div className="flex shrink-0 items-center gap-1">
                            <ActionBtn
                              onClick={() => onOpenInTab?.(t.id)}
                              title="Abrir en una pestaña para trabajar"
                            >
                              Abrir
                            </ActionBtn>
                            <ActionBtn
                              onClick={() => startEdit(t)}
                              disabled={locked}
                              title={locked ? 'Oficial: solo La Recta puede editarla' : 'Renombrar / cambiar de carpeta'}
                            >
                              Editar
                            </ActionBtn>
                            <ActionBtn
                              onClick={() => onEditGeometry?.(t)}
                              disabled={locked || isPdf}
                              title={
                                isPdf
                                  ? 'Las plantillas de PDF se editan subiendo el PDF de nuevo'
                                  : locked
                                    ? 'Oficial: solo La Recta puede editarla'
                                    : 'Editar medidas, márgenes, separación y cortes'
                              }
                            >
                              Medidas
                            </ActionBtn>
                            <ActionBtn
                              onClick={() => onDuplicate?.(t)}
                              title="Crear una copia editable de esta plantilla"
                            >
                              Duplicar
                            </ActionBtn>
                            {isLaRecta && onToggleOficial && (
                              <ActionBtn
                                onClick={() => onToggleOficial(t)}
                                tone={t.oficial ? 'amber' : 'default'}
                                title={t.oficial ? 'Quitar de oficiales (deja de alimentar la web)' : 'Marcar como oficial (alimenta la web/CRM)'}
                              >
                                {t.oficial ? 'Quitar oficial' : 'Marcar oficial'}
                              </ActionBtn>
                            )}
                            <ActionBtn
                              onClick={() => {
                                if (confirm(`¿Eliminar la plantilla "${t.name}"?`)) onDelete?.(t.id);
                              }}
                              disabled={locked}
                              tone="danger"
                              title={locked ? 'Oficial: solo La Recta puede borrarla' : 'Eliminar plantilla'}
                            >
                              Eliminar
                            </ActionBtn>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-ink-700 px-4 py-3">
          <p className="text-[11px] text-ink-500">
            {isLaRecta
              ? 'Modo La Recta: podés marcar oficiales y editar todo.'
              : 'Las plantillas “oficiales” están protegidas (🔒).'}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionBtn({ children, onClick, disabled = false, tone = 'default', title }) {
  const tones = {
    default: 'border-ink-600 text-ink-200 hover:bg-ink-700',
    amber: 'border-amber-500/40 text-amber-300 hover:bg-amber-500/15',
    danger: 'border-red-500/40 text-red-300 hover:bg-red-500/15',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded border px-2 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-30 ${tones[tone] || tones.default}`}
    >
      {children}
    </button>
  );
}
