import { useCallback, useEffect, useMemo, useState } from 'react';
import { BUILTIN_PAPER_PRESETS } from '../lib/grid.js';

// Hook que combina los presets de hoja built-in (codigo) + los custom (store).
// La UI ve una lista unificada, pero los builtin estan flageados con
// `builtin: true` para que el editor no los deje borrar/editar.
export function usePaperPresets() {
  const [customPresets, setCustomPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [canSync, setCanSync] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const list = await window.printlayout.paperPresets.list();
      const able = await window.printlayout.paperPresets.canSync();
      if (mounted) {
        setCustomPresets(Array.isArray(list) ? list : []);
        setCanSync(!!able);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const list = await window.printlayout.paperPresets.list();
    setCustomPresets(Array.isArray(list) ? list : []);
  }, []);

  const save = useCallback(async (preset) => {
    const saved = await window.printlayout.paperPresets.save(preset);
    setCustomPresets((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    return saved;
  }, []);

  const remove = useCallback(async (id) => {
    await window.printlayout.paperPresets.delete(id);
    setCustomPresets((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const syncPull = useCallback(async () => {
    const res = await window.printlayout.paperPresets.syncPull();
    if (res?.ok && (res.added?.length || res.updated?.length)) {
      const list = await window.printlayout.paperPresets.list();
      setCustomPresets(Array.isArray(list) ? list : []);
    }
    return res;
  }, []);

  const syncPush = useCallback(async () => {
    const res = await window.printlayout.paperPresets.syncPush();
    if (res?.ok) {
      const list = await window.printlayout.paperPresets.list();
      setCustomPresets(Array.isArray(list) ? list : []);
    }
    return res;
  }, []);

  // Vista unificada: builtin primero, luego custom ordenados por label.
  const allPresets = useMemo(() => {
    const sortedCustom = [...customPresets].sort((a, b) =>
      (a.label || '').localeCompare(b.label || ''),
    );
    return [...BUILTIN_PAPER_PRESETS, ...sortedCustom];
  }, [customPresets]);

  return {
    allPresets,
    customPresets,
    loading,
    canSync,
    refresh,
    save,
    remove,
    syncPull,
    syncPush,
  };
}
