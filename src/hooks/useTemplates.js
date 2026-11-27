import { useCallback, useEffect, useState } from 'react';
import { buildTagCuts, mirrorCellsX, tagHoleDefaults } from '../lib/tagSheets.js';

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
    { markMarginMm = 10, doubleSided = false, tags = false, name: customName, categoria } = {},
  ) => {
    if (!file) throw new Error('Archivo no provisto.');
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const parsed = await window.printlayout.templates.parsePdf(bytes, {
      doubleSided,
      tags,
    });
    if (!parsed?.ok) {
      throw new Error(parsed?.error || 'No se pudo parsear el PDF.');
    }
    const fallbackName = file.name.replace(/\.pdf$/i, '');
    const name = (customName || '').trim() || fallbackName;
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const pdfBase64 = btoa(bin);

    // Plancha de TAGS: el PDF trae el arte del frente y del dorso, los recuadros
    // del logo y el corte. NO va en `pdfBase64` (eso significa "las marcas ya
    // vienen dibujadas"): acá las marcas y el QR los pone la app, como en una
    // grilla. El arte viaja en `tags.pdfBase64`.
    if (tags) {
      const cajas = parsed.celdasDorso ?? [];
      if (cajas.length === 0) {
        throw new Error('La página 3 no tiene ningún recuadro para el logo. Dibujá un rectángulo donde va el logo de cada tag.');
      }
      const cortesBase = parsed.cortes ?? [];
      const hole = tagHoleDefaults(cortesBase);
      const tagsTpl = {
        name,
        pdfBase64: null,
        pageWidthMm: parsed.pageWidthMm,
        pageHeightMm: parsed.pageHeightMm,
        pageCount: 1,
        singlePage: true,
        doubleSided: true,
        backMirror: 'x',
        backRotate180: false,
        // El logo va en el DORSO. Las celdas del frente son solo el "lugar que
        // cae detrás" de cada logo: no se muestran ni se imprimen.
        celdas: mirrorCellsX(cajas, parsed.pageWidthMm),
        celdasDorso: cajas,
        cortes: buildTagCuts(cortesBase, hole),
        cutMarginMm: 0,
        cutShape: 'rect',
        markMarginMm,
        conQr: true,
        fitMode: 'contain',
        tags: { pdfBase64, cortesBase, hole },
        categoria: (categoria || '').trim() || undefined,
      };
      const savedTags = await window.printlayout.templates.save(tagsTpl);
      setTemplates((prev) => [...prev, savedTags]);
      return savedTags;
    }

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

  // Borra una plantilla del repo compartido (todas las PCs) y de esta PC.
  // Devuelve el resultado del IPC para que la UI avise si falla.
  const removeShared = useCallback(async (id) => {
    const res = await window.printlayout.templates.deleteShared(id);
    if (res?.ok) {
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    }
    return res;
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
      && (res.added?.length || res.updated?.length || res.replaced?.length || res.removed?.length)
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
    removeShared,
    share,
    syncPull,
  };
}
