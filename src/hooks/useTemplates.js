import { useCallback, useEffect, useState } from 'react';

export function useTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const list = await window.printlayout.templates.list();
      if (mounted) {
        setTemplates(list);
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
  const createFromPdf = useCallback(async (file, { markMarginMm = 10, doubleSided = false } = {}) => {
    if (!file) throw new Error('Archivo no provisto.');
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const parsed = await window.printlayout.templates.parsePdf(bytes, {
      doubleSided,
    });
    if (!parsed?.ok) {
      throw new Error(parsed?.error || 'No se pudo parsear el PDF.');
    }
    const name = file.name.replace(/\.pdf$/i, '');
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const pdfBase64 = btoa(bin);

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
      doubleSided,
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

  return { templates, loading, refresh, createFromPdf, update, remove };
}
