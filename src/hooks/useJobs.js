import { useCallback, useEffect, useState } from 'react';

// Lista + CRUD de trabajos guardados. Mantiene en memoria solo metadata
// liviana (sin imagenes embebidas) — para abrir un job hay que llamar
// `load(id)` y recibir el payload completo.
export function useJobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  const api = typeof window !== 'undefined' ? window.printlayout?.jobs : null;

  const refresh = useCallback(async () => {
    if (!api?.list) {
      setJobs([]);
      setLoading(false);
      return;
    }
    try {
      const list = await api.list();
      setJobs(Array.isArray(list) ? list : []);
    } catch (err) {
      console.warn('[jobs] list fallo:', err);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(async (payload) => {
    if (!api?.save) return { ok: false, error: 'API no disponible' };
    const r = await api.save(payload);
    if (r?.ok) await refresh();
    return r;
  }, [api, refresh]);

  const remove = useCallback(async (id) => {
    if (!api?.delete) return { ok: false };
    await api.delete(id);
    await refresh();
    return { ok: true };
  }, [api, refresh]);

  const load = useCallback(async (id) => {
    if (!api?.load) return null;
    return api.load(id);
  }, [api]);

  return { jobs, loading, refresh, save, remove, load };
}
