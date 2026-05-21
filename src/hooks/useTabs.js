import { useCallback, useState } from 'react';

// Gestor de tabs (multi-doc). Cada tab contiene el state "de identidad" del
// trabajo: template embebido (copia self-contained con id sintetico),
// nombre, jobId si fue guardado, isDirty, y opciones de vista (viewingFace,
// currentPage, customPaper). El state del editor en si (images, assignments,
// minPages, undo/redo) lo maneja useLayoutEditor via su templateStatesRef
// keyed por template id — al cambiar de tab, el template id cambia y
// useLayoutEditor restora desde su Map.

function makeTabId() {
  return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// Devuelve "Sin titulo N" con N = max existente + 1.
function nextDefaultName(tabs) {
  let max = 0;
  for (const t of tabs) {
    const m = /^Sin titulo (\d+)$/.exec(t.name || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Sin titulo ${max + 1}`;
}

function createEmptyTab(name) {
  return {
    id: makeTabId(),
    name,
    jobId: null,
    isDirty: false,
    template: null,
    viewingFace: 'front',
    currentPage: 0,
    customPaper: null,
  };
}

export function useTabs() {
  // El primer tab nace al mount. App.jsx lo va a popular al hacer la primera
  // accion del usuario (click en plantilla, +Grilla, etc.).
  const [tabs, setTabs] = useState(() => [createEmptyTab('Sin titulo 1')]);
  const [activeTabId, setActiveTabId] = useState(() => tabs?.[0]?.id ?? null);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0] || null;

  // Crea una tab nueva. `init` puede traer cualquier subset del shape de tab.
  // Si no se pasa name, asigna "Sin titulo N". Activa la tab por default.
  const createTab = useCallback((init = {}, { activate = true } = {}) => {
    const base = createEmptyTab('');
    const tab = { ...base, ...init };
    let assignedId = tab.id;
    setTabs((prev) => {
      if (!tab.name) tab.name = nextDefaultName(prev);
      return [...prev, tab];
    });
    if (activate) setActiveTabId(assignedId);
    return assignedId;
  }, []);

  // Cierra una tab. Si era la activa, switchea al vecino (siguiente o
  // anterior). Si era la unica, crea una nueva vacia. NO chequea isDirty —
  // el caller debe pedir confirmacion antes.
  const closeTab = useCallback((id) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh = createEmptyTab('Sin titulo 1');
        setActiveTabId(fresh.id);
        return [fresh];
      }
      setActiveTabId((cur) => {
        if (cur !== id) return cur;
        const neighbor = next[Math.min(idx, next.length - 1)];
        return neighbor.id;
      });
      return next;
    });
  }, []);

  const switchTab = useCallback((id) => {
    setActiveTabId(id);
  }, []);

  const updateTab = useCallback((id, updates) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  }, []);

  // Reemplaza el state activo. updates puede ser objeto o funcion(prev) =>
  // partial. Si el activo no existe (caso borde), no-op.
  const updateActiveTab = useCallback((updates) => {
    setTabs((prev) => prev.map((t) => {
      if (t.id !== activeTabId) return t;
      const partial = typeof updates === 'function' ? updates(t) : updates;
      return { ...t, ...partial };
    }));
  }, [activeTabId]);

  return {
    tabs,
    activeTab,
    activeTabId,
    createTab,
    closeTab,
    switchTab,
    updateTab,
    updateActiveTab,
  };
}
