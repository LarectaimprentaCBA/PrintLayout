import { useCallback, useEffect, useRef, useState } from 'react';
import { dbg } from '../lib/debugLog.js';
import { mergeRestoredTabs, tieneTrabajo } from '../lib/restoreTabs.js';

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

// Al arrancar, las pestañas de la última vez se abren SOLAS (sin preguntar).
// Red de seguridad: si la vez anterior la app se cerró mientras las estaba
// abriendo (un trabajo que la cuelga), no insistimos a ciegas — ahí sí se
// pregunta, para que quede la salida de "Empezar nuevo".
const LS_RESTORE_EN_CURSO = 'printlayout.restoreEnCurso';
const RESTORE_OK_MS = 15000; // viva este rato después de abrirlas = salió bien

function leerRestoreEnCurso() {
  try { return !!localStorage.getItem(LS_RESTORE_EN_CURSO); } catch { return false; }
}
function marcarRestoreEnCurso() {
  try { localStorage.setItem(LS_RESTORE_EN_CURSO, String(Date.now())); } catch { /* sin storage */ }
}
function limpiarRestoreEnCurso() {
  try { localStorage.removeItem(LS_RESTORE_EN_CURSO); } catch { /* sin storage */ }
}

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
  // Si el restore async encuentra tabs persistidas, se abren solas (el usuario
  // sigue donde estaba, sin apretar "Restaurar"). Solo si la vez anterior la
  // app se cerro mientras las abria quedan en pending y se pregunta.
  const [tabs, setTabs] = useState(() => [createEmptyTab('Sin titulo 1')]);
  const [activeTabId, setActiveTabId] = useState(() => tabs?.[0]?.id ?? null);
  const [restoring, setRestoring] = useState(true);
  // null = nada para restaurar. Objeto = { tabs, activeTabId } esperando
  // confirmacion del usuario via confirmRestore/discardRestore.
  const [pendingRestore, setPendingRestore] = useState(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0] || null;

  // Lo ultimo que se ve en pantalla, para juntarlo con lo restaurado.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // Abre las pestañas guardadas. Deja la marca "abriendo" y la saca si la app
  // sigue viva un rato despues (= no se colgo abriendolas).
  const restoreOkTimerRef = useRef(null);
  const aplicarRestore = useCallback((guardado) => {
    marcarRestoreEnCurso();
    const r = mergeRestoredTabs(tabsRef.current, activeTabIdRef.current, guardado.tabs, guardado.activeTabId);
    dbg(`[tab] restore: ${guardado.tabs.length} guardadas + ${r.tabs.length - guardado.tabs.length} ya abiertas → activa ${r.activeTabId}`);
    setTabs(r.tabs);
    setActiveTabId(r.activeTabId);
    if (restoreOkTimerRef.current) clearTimeout(restoreOkTimerRef.current);
    restoreOkTimerRef.current = setTimeout(limpiarRestoreEnCurso, RESTORE_OK_MS);
  }, []);

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
        const wantId = data?.activeTabId;
        const exists = wantId && list.some((t) => t.id === wantId);
        const guardado = { tabs: list, activeTabId: exists ? wantId : list[0].id };
        // ¿Hay algo que valga la pena abrir? (una sola pestaña vacia = nada)
        const hayTrabajo = list.some(tieneTrabajo);
        if (hayTrabajo && leerRestoreEnCurso()) {
          // La vez anterior no termino de abrirlas: preguntar.
          setPendingRestore({ ...guardado, porFalla: true });
        } else {
          aplicarRestore(guardado);
        }
      }
      setRestoring(false);
    }).catch((err) => {
      console.warn('[open-tabs] restore fallo:', err);
      if (!cancelled) setRestoring(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Aplica el restore pendiente: reemplaza las tabs en memoria por las
  // persistidas y limpia el pending. El auto-save reanudara guardando esta
  // misma lista (no hay pisada).
  const confirmRestore = useCallback(() => {
    if (!pendingRestore) return;
    aplicarRestore(pendingRestore);
    setPendingRestore(null);
  }, [pendingRestore, aplicarRestore]);

  // Descarta el restore pendiente: borra las tabs persistidas del disco y los
  // work-states asociados (asi al proximo arranque empieza realmente limpio).
  // Mantiene la tab vacia inicial.
  const discardRestore = useCallback(() => {
    limpiarRestoreEnCurso();
    setPendingRestore((pending) => {
      if (!pending) return null;
      const wsApi = typeof window !== 'undefined' ? window.printlayout?.workStates : null;
      const tabsApi = typeof window !== 'undefined' ? window.printlayout?.openTabs : null;
      // Borrar work-state de cada template descartado, asi no quedan huerfanos
      // (los templates sinteticos de grilla/auto/count no se referencian desde
      // ningun lado mas).
      if (wsApi?.delete) {
        for (const t of pending.tabs) {
          const tplId = t?.template?.id;
          if (tplId) wsApi.delete(tplId).catch(() => {});
        }
      }
      // Pisar el archivo de openTabs con el estado actual (tab vacia inicial)
      // sin esperar al debounce, asi un cierre rapido no recupera lo viejo.
      if (tabsApi?.save) {
        tabsApi.save({ tabs, activeTabId }).catch(() => {});
      }
      return null;
    });
  }, [tabs, activeTabId]);

  // Auto-save debounced de la lista de tabs (+ activeTabId). No persistimos
  // mientras restoring=true (sino el primer write pisaria lo que estamos por
  // cargar) ni mientras pendingRestore != null (el usuario todavia no decidio
  // si restaurar o no — un write con la tab vacia inicial pisaria lo
  // persistido y perderia la sesion anterior). En cada cambio cancelamos el
  // timer anterior: solo el ultimo cambio dispara el write.
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (restoring || pendingRestore) return undefined;
    const api = typeof window !== 'undefined' ? window.printlayout?.openTabs : null;
    if (!api?.save) return undefined;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const snapshot = { tabs, activeTabId };
    saveTimerRef.current = setTimeout(() => {
      api.save(snapshot).catch((err) => console.warn('[open-tabs] save fallo:', err));
    }, SAVE_DEBOUNCE_MS);
    return undefined; // dejar fire si se desmonta
  }, [tabs, activeTabId, restoring, pendingRestore]);

  // Crea una tab nueva. `init` puede traer cualquier subset del shape de tab.
  // Si no se pasa name, asigna "Sin titulo N". Activa la tab por default.
  const createTab = useCallback((init = {}, { activate = true } = {}) => {
    const base = createEmptyTab('');
    const tab = { ...base, ...init };
    const assignedId = tab.id;
    dbg(`[tab] createTab id=${assignedId} tpl=${tab.template?.id ?? '-'} name="${tab.name || '(auto)'}" activate=${activate}`);
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
      dbg(`[tab] closeTab id=${id} tpl=${tplId ?? '-'} name="${tab?.name ?? ''}" isDirty=${tab?.isDirty} → DELETE work-state`);
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
    dbg(`[tab] switchTab → ${id}`);
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
    pendingRestore,
    confirmRestore,
    discardRestore,
    createTab,
    closeTab,
    switchTab,
    updateTab,
    updateActiveTab,
    reorderTab,
  };
}
