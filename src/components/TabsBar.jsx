import { useEffect, useRef, useState } from 'react';

// Tab bar estilo Corel/Photoshop. Muestra los tabs abiertos, marca el activo,
// indicador * (asterisco) si dirty, X para cerrar (con confirm en App.jsx si
// dirty), doble click en la pestana para renombrar inline, right-click para
// menu contextual. Boton "+" al final crea una tab vacia (en App.jsx esta
// cableado para abrir el modal "Nuevo trabajo").
//
// Props:
//   tabs: Array<TabState>
//   activeTabId: string
//   onSwitch(id), onClose(id), onRename(id, newName), onNew()
//   onDuplicate(id), onSaveAs(id), onCloseOthers(id), onCloseAll()
export default function TabsBar({
  tabs,
  activeTabId,
  onSwitch,
  onClose,
  onRename,
  onNew,
  onDuplicate,
  onSaveAs,
  onCloseOthers,
  onCloseAll,
  onReorder,
}) {
  const [renamingId, setRenamingId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [contextMenu, setContextMenu] = useState(null); // { id, x, y } | null
  // Drag state: id de la tab que se esta arrastrando, y el id+lado donde
  // caeria si se sueltara ahora. `place` = 'before' | 'after'.
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null); // { id, place } | null
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (renamingId) setTimeout(() => inputRef.current?.select(), 0);
  }, [renamingId]);

  // Cerrar el menu al click afuera o Escape.
  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  // Scroll horizontal con la rueda del mouse (cualquier eje). Asi con muchas
  // tabs alcanza con scrollear sin tener que agarrar la barra inferior.
  const handleWheel = (e) => {
    const el = scrollRef.current;
    if (!el) return;
    const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    if (delta === 0) return;
    el.scrollLeft += delta;
  };

  const startRename = (tab) => {
    setRenamingId(tab.id);
    setDraftName(tab.name || '');
  };

  const commitRename = () => {
    const id = renamingId;
    const name = draftName.trim();
    setRenamingId(null);
    if (id && name) onRename?.(id, name);
  };

  const cancelRename = () => {
    setRenamingId(null);
  };

  const openContextMenu = (e, tab) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ id: tab.id, x: e.clientX, y: e.clientY });
  };

  const ctxTab = contextMenu ? tabs.find((t) => t.id === contextMenu.id) : null;

  return (
    <div className="flex h-9 shrink-0 items-end border-b border-ink-700 bg-ink-950 pl-2">
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        className="flex flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden pr-2"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isRenaming = renamingId === tab.id;
          const isDragging = dragId === tab.id;
          const showLeftBar = dragOver?.id === tab.id && dragOver.place === 'before';
          const showRightBar = dragOver?.id === tab.id && dragOver.place === 'after';
          return (
            <div
              key={tab.id}
              draggable={!isRenaming && !!onReorder}
              onDragStart={(e) => {
                if (isRenaming || !onReorder) { e.preventDefault(); return; }
                setDragId(tab.id);
                try { e.dataTransfer.setData('text/plain', tab.id); } catch {}
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => { setDragId(null); setDragOver(null); }}
              onDragOver={(e) => {
                if (!dragId || dragId === tab.id || !onReorder) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = e.currentTarget.getBoundingClientRect();
                const mid = rect.left + rect.width / 2;
                const place = e.clientX < mid ? 'before' : 'after';
                if (dragOver?.id !== tab.id || dragOver.place !== place) {
                  setDragOver({ id: tab.id, place });
                }
              }}
              onDrop={(e) => {
                if (!dragId || !onReorder) return;
                e.preventDefault();
                const place = dragOver?.id === tab.id ? dragOver.place : 'before';
                onReorder(dragId, tab.id, place);
                setDragId(null);
                setDragOver(null);
              }}
              onClick={() => !isRenaming && onSwitch?.(tab.id)}
              onDoubleClick={() => !isRenaming && startRename(tab)}
              onContextMenu={(e) => openContextMenu(e, tab)}
              onMouseDown={(e) => {
                // Middle-click cierra la tab (convencion browser/IDE).
                if (e.button === 1) {
                  e.preventDefault();
                  onClose?.(tab.id);
                }
              }}
              title={tab.name + (tab.isDirty ? ' (sin guardar)' : '')}
              className={`group relative flex h-8 min-w-[120px] max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-xs ${
                isDragging ? 'opacity-50' : ''
              } ${
                isActive
                  ? 'border-ink-700 bg-ink-900 text-ink-100'
                  : 'border-transparent text-ink-400 hover:bg-ink-900/60 hover:text-ink-200'
              }`}
            >
              {showLeftBar && (
                <span className="pointer-events-none absolute -left-px top-1 bottom-0 w-0.5 rounded bg-accent-400" />
              )}
              {showRightBar && (
                <span className="pointer-events-none absolute -right-px top-1 bottom-0 w-0.5 rounded bg-accent-400" />
              )}
              {tab.isDirty && (
                <span
                  className="shrink-0 leading-none text-amber-300/80"
                  aria-hidden
                  title="Sin guardar"
                >
                  *
                </span>
              )}
              {isRenaming ? (
                <input
                  ref={inputRef}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-0 flex-1 rounded border border-accent-500/60 bg-ink-800 px-1 text-xs text-ink-100 outline-none"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate">{tab.name || 'Sin titulo'}</span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose?.(tab.id);
                }}
                title="Cerrar (mid-click)"
                className={`shrink-0 rounded p-0.5 leading-none text-ink-500 hover:bg-ink-700 hover:text-ink-100 ${
                  isActive ? '' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" stroke="currentColor" strokeWidth="1.5" fill="none">
                  <path d="M1 1 L9 9 M9 1 L1 9" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={onNew}
          title="Nuevo trabajo (Ctrl+T)"
          className="ml-1 mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 hover:bg-ink-800 hover:text-ink-100"
        >
          <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="1.75" fill="none">
            <path d="M7 2 V12 M2 7 H12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {contextMenu && ctxTab && (
        <div
          className="fixed z-50 min-w-[180px] overflow-hidden rounded-md border border-ink-700 bg-ink-900 py-1 text-xs text-ink-200 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem onClick={() => { setContextMenu(null); startRename(ctxTab); }}>
            Renombrar
          </MenuItem>
          {onDuplicate && (
            <MenuItem onClick={() => { setContextMenu(null); onDuplicate(ctxTab.id); }}>
              Duplicar
            </MenuItem>
          )}
          {onSaveAs && (
            <MenuItem onClick={() => { setContextMenu(null); onSaveAs(ctxTab.id); }}>
              Guardar como…
            </MenuItem>
          )}
          <div className="my-1 h-px bg-ink-700" />
          <MenuItem onClick={() => { setContextMenu(null); onClose?.(ctxTab.id); }}>
            Cerrar
          </MenuItem>
          {onCloseOthers && tabs.length > 1 && (
            <MenuItem onClick={() => { setContextMenu(null); onCloseOthers(ctxTab.id); }}>
              Cerrar otras
            </MenuItem>
          )}
          {onCloseAll && tabs.length > 1 && (
            <MenuItem onClick={() => { setContextMenu(null); onCloseAll(); }}>
              Cerrar todas
            </MenuItem>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left hover:bg-ink-800 hover:text-ink-100"
    >
      {children}
    </button>
  );
}
