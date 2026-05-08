import { useCallback, useEffect, useState } from 'react';

export function useTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const list = await window.printlayout.templates.list();
      const able = await window.printlayout.templates.canShare();
      if (mounted) {
        setTemplates(list);
        setCanShare(!!able);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const list = await window.printlayout.templates.list();
    setTemplates(list);
  }, []);

  // Subir un PDF -> parsearlo en el backend Python -> guardar plantilla.
  const createFromPdf = useCallback(async (
    file,
    { markMarginMm = 10, doubleSided = false, name: customName, categoria } = {},
  ) => {
    if (!file) throw new Error('Archivo no provisto.');
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const parsed = await window.printlayout.templates.parsePdf(bytes, {
      doubleSided,
    });
    if (!parsed?.ok) {
      throw new Error(parsed?.error || 'No se pudo parsear el PDF.');
    }
    const fallbackName = file.name.replace(/\.pdf$/i, '');
    const name = (customName || '').trim() || fallbackName;
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const pdfBase64 = btoa(bin);

    const isSinglePage = !!parsed.singlePage;
    const tpl = {
      name,
      pdfBase64,
      pageWidthMm: parsed.pageWidthMm,
      pageHeightMm: parsed.pageHeightMm,
      pageCount: parsed.pageCount,
      celdas: parsed.celdas,
      celdasDorso: parsed.celdasDorso ?? [],
      cortes: parsed.cortes ?? [],
      markMarginMm,
      // En modo 1-pagina, el PDF solo aporta las cajas como referencia
      // visual; no hay marcas para imprimir ni dorso.
      doubleSided: isSinglePage ? false : doubleSided,
      singlePage: isSinglePage,
      categoria: (categoria || '').trim() || undefined,
    };
    const saved = await window.printlayout.templates.save(tpl);
    setTemplates((prev) => [...prev, saved]);
    return saved;
  }, []);

  const update = useCallback(async (template) => {
    const saved = await window.printlayout.templates.save(template);
    setTemplates((prev) => {
      const idx = prev.findIndex((t) => t.id === saved.id);
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
    await window.printlayout.templates.delete(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const share = useCallback(async (template) => {
    const res = await window.printlayout.templates.share(template);
    if (res?.ok && res.template) {
      setTemplates((prev) => {
        const idx = prev.findIndex((t) => t.id === res.template.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = res.template;
          return next;
        }
        return prev;
      });
    }
    return res;
  }, []);

  // Pull-only sync. El handler IPC ya guarda los cambios en el store; aca
  // simplemente refrescamos el state para que la UI los muestre.
  const syncPull = useCallback(async () => {
    const res = await window.printlayout.templates.syncPull();
    if (
      res?.ok
      && (res.added?.length || res.updated?.length || res.replaced?.length)
    ) {
      const list = await window.printlayout.templates.list();
      setTemplates(list);
    }
    return res;
  }, []);

  return {
    templates,
    loading,
    canShare,
    refresh,
    createFromPdf,
    update,
    remove,
    share,
    syncPull,
  };
}
