import { useEffect, useRef, useState } from 'react';

// Tab bar estilo Corel/Photoshop. Muestra los tabs abiertos, marca el activo,
// indicador ● ambar si dirty, X para cerrar (con confirm en App.jsx si dirty),
// doble click en la pestana para renombrar inline. Boton "+" al final crea
// una tab vacia.
//
// Props:
//   tabs: Array<TabState>
//   activeTabId: string
//   onSwitch(id), onClose(id), onRename(id, newName), onNew()
export default function TabsBar({
  tabs,
  activeTabId,
  onSwitch,
  onClose,
  onRename,
  onNew,
}) {
  const [renamingId, setRenamingId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (renamingId) setTimeout(() => inputRef.current?.select(), 0);
  }, [renamingId]);

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

  return (
    <div className="flex h-9 shrink-0 items-end border-b border-ink-700 bg-ink-950 pl-2">
      <div className="flex flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isRenaming = renamingId === tab.id;
          return (
            <div
              key={tab.id}
              onClick={() => !isRenaming && onSwitch?.(tab.id)}
              onDoubleClick={() => !isRenaming && startRename(tab)}
              onMouseDown={(e) => {
                // Middle-click cierra la tab (convencion browser/IDE).
                if (e.button === 1) {
                  e.preventDefault();
                  onClose?.(tab.id);
                }
              }}
              title={tab.name + (tab.isDirty ? ' (sin guardar)' : '')}
              className={`group flex h-8 min-w-[120px] max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-xs ${
                isActive
                  ? 'border-ink-700 bg-ink-900 text-ink-100'
                  : 'border-transparent text-ink-400 hover:bg-ink-900/60 hover:text-ink-200'
              }`}
            >
              {tab.isDirty && (
                <span className="shrink-0 text-amber-300" aria-hidden>●</span>
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
    </div>
  );
}
