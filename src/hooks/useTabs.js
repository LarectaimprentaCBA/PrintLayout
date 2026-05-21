import { useCallback, useEffect, useRef, useState } from 'react';

// Gestor de tabs (multi-doc). Cada tab contiene el state "de identidad" del
// trabajo: template embebido (copia self-contained con id sintetico),
// nombre, jobId si fue guardado, isDirty, y opciones de vista (viewingFace,
// currentPage, customPaper). El state del editor en si (images, assignments,
// minPages, undo/redo) lo maneja useLayoutEditor via su templateStatesRef
// keyed por template id — al cambiar de tab, el template id cambia y
// useLayoutEditor restora desde su Map.
//
// Persistencia (Fase E):
//   - Al mount, intentamos cargar la lista de tabs persistida desde disco.
//     Si hay, las restauramos. Si no, arrancamos con "Sin titulo 1".
//   - En cada cambio, persistimos la lista entera con un debounce de 800ms.
//   - Al cerrar una tab, eliminamos su archivo de work-states asociado al
//     template id sintetico (asi no quedan huerfanos en disco).

const SAVE_DEBOUNCE_MS = 800;

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
    jobPath: null,
    isDirty: false,
    template: null,
    viewingFace: 'front',
    currentPage: 0,
    customPaper: null,
  };
}

// Filtra metadata invalida que pudiera haberse colado en el archivo. Limita
// los keys que esperamos. Templates incompletos pasan tal cual (no podemos
// validar su shape aca sin acoplar a templates.js).
function sanitizeTab(t) {
  if (!t || typeof t !== 'object') return null;
  if (!t.id || typeof t.id !== 'string') return null;
  return {
    id: t.id,
    name: typeof t.name === 'string' ? t.name : 'Sin titulo',
    jobId: typeof t.jobId === 'string' ? t.jobId : null,
    jobPath: typeof t.jobPath === 'string' ? t.jobPath : null,
    isDirty: !!t.isDirty,
    template: t.template && typeof t.template === 'object' ? t.template : null,
    viewingFace: t.viewingFace === 'back' ? 'back' : 'front',
    currentPage: Number.isFinite(t.currentPage) ? t.currentPage : 0,
    customPaper: t.customPaper && typeof t.customPaper === 'object' ? t.customPaper : null,
  };
}

export function useTabs() {
  // Mientras restauramos del disco, arrancamos con una tab vacia. Asi App.jsx
  // siempre tiene activeTab !== null y no hay loading state que romper.
  // Si el restore async encuentra tabs persistidas, las reemplaza.
  const [tabs, setTabs] = useState(() => [createEmptyTab('Sin titulo 1')]);
  const [activeTabId, setActiveTabId] = useState(() => tabs?.[0]?.id ?? null);
  const [restoring, setRestoring] = useState(true);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0] || null;

  // Restore async al mount.
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.printlayout?.openTabs : null;
    if (!api?.load) {
      setRestoring(false);
      return undefined;
    }
    let cancelled = false;
    api.load().then((data) => {
      if (cancelled) return;
      const list = Array.isArray(data?.tabs)
        ? data.tabs.map(sanitizeTab).filter(Boolean)
        : [];
      if (list.length > 0) {
        setTabs(list);
        const wantId = data?.activeTabId;
        const exists = wantId && list.some((t) => t.id === wantId);
        setActiveTabId(exists ? wantId : list[0].id);
      }
      setRestoring(false);
    }).catch((err) => {
      console.warn('[open-tabs] restore fallo:', err);
      if (!cancelled) setRestoring(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Auto-save debounced de la lista de tabs (+ activeTabId). No persistimos
  // mientras restoring=true (sino el primer write pisaria lo que estamos por
  // cargar). En cada cambio cancelamos el timer anterior: solo el ultimo
  // cambio dispara el write.
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (restoring) return undefined;
    const api = typeof window !== 'undefined' ? window.printlayout?.openTabs : null;
    if (!api?.save) return undefined;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const snapshot = { tabs, activeTabId };
    saveTimerRef.current = setTimeout(() => {
      api.save(snapshot).catch((err) => console.warn('[open-tabs] save fallo:', err));
    }, SAVE_DEBOUNCE_MS);
    return undefined; // dejar fire si se desmonta
  }, [tabs, activeTabId, restoring]);

  // Crea una tab nueva. `init` puede traer cualquier subset del shape de tab.
  // Si no se pasa name, asigna "Sin titulo N". Activa la tab por default.
  const createTab = useCallback((init = {}, { activate = true } = {}) => {
    const base = createEmptyTab('');
    const tab = { ...base, ...init };
    const assignedId = tab.id;
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
  // Como cleanup: borra del disco el work-state asociado al template
  // sintetico de la tab, asi no quedan huerfanos cuando el usuario cierra
  // un tab de grilla rapida / auto / etc.
  const closeTab = useCallback((id) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const tab = prev[idx];
      // Cleanup async del work-state. No blockea el cierre.
      const tplId = tab?.template?.id;
      if (tplId) {
        const wsApi = typeof window !== 'undefined' ? window.printlayout?.workStates : null;
        if (wsApi?.delete) {
          wsApi.delete(tplId).catch(() => {});
        }
      }
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

  // Mueve una tab a la posicion de otra. Si dragId === targetId, no-op.
  // place='before' inserta justo antes del target; 'after' justo despues.
  const reorderTab = useCallback((dragId, targetId, place = 'before') => {
    if (!dragId || !targetId || dragId === targetId) return;
    setTabs((prev) => {
      const dragIdx = prev.findIndex((t) => t.id === dragId);
      const targetIdx = prev.findIndex((t) => t.id === targetId);
      if (dragIdx < 0 || targetIdx < 0) return prev;
      const next = prev.slice();
      const [dragged] = next.splice(dragIdx, 1);
      // Recalcular indice del target ahora que sacamos dragged.
      let insertAt = next.findIndex((t) => t.id === targetId);
      if (place === 'after') insertAt += 1;
      next.splice(insertAt, 0, dragged);
      return next;
    });
  }, []);

  return {
    tabs,
    activeTab,
    activeTabId,
    restoring,
    createTab,
    closeTab,
    switchTab,
    updateTab,
    updateActiveTab,
    reorderTab,
  };
}
