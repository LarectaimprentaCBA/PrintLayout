import { useEffect, useRef, useState } from 'react';
import { extendImageToSize } from '../lib/imageExtend.js';

// Editor por imagen. Trabaja sobre la imagen "como archivo": permite
// indicar que tamanio fisico (mm) representa hoy y a que tamanio quiere
// llevarla. La imagen modificada reemplaza al dataUrl original.
//
// Edge replicate se usa para rellenar los bordes cuando target > actual.
// Si target < actual, la imagen se recorta centrada.
export default function ImageEditorModal({
  open,
  image,
  onSave,
  onClose,
}) {
  const [actualW, setActualW] = useState('');
  const [actualH, setActualH] = useState('');
  const [targetW, setTargetW] = useState('');
  const [targetH, setTargetH] = useState('');
  const [previewUrl, setPreviewUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef(null);

  const aspectFromImg = image ? image.width / image.height : 1;

  // Inicializar valores al abrir.
  useEffect(() => {
    if (!open || !image) return;
    const stored = image.physicalSizeMm;
    if (stored) {
      setActualW(String(stored.w));
      setActualH(String(stored.h));
      setTargetW(String(stored.w));
      setTargetH(String(stored.h));
    } else {
      // Sin tamanio fisico previo, partimos de un default razonable
      // basado en el aspect del archivo.
      const defaultW = 50;
      const defaultH = defaultW / aspectFromImg;
      setActualW(String(defaultW.toFixed(1)));
      setActualH(String(defaultH.toFixed(1)));
      setTargetW(String(defaultW.toFixed(1)));
      setTargetH(String(defaultH.toFixed(1)));
    }
  }, [open, image, aspectFromImg]);

  // Generar preview cuando cambian los valores.
  useEffect(() => {
    if (!open || !image) return;
    const aw = parseFloat(actualW);
    const ah = parseFloat(actualH);
    const tw = parseFloat(targetW);
    const th = parseFloat(targetH);
    if (!Number.isFinite(aw) || !Number.isFinite(ah)
        || !Number.isFinite(tw) || !Number.isFinite(th)
        || aw <= 0 || ah <= 0 || tw <= 0 || th <= 0) {
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setBusy(true);
      try {
        const out = await extendImageToSize(
          image.dataUrl,
          { w: aw, h: ah },
          { w: tw, h: th },
        );
        setPreviewUrl(out.dataUrl);
      } catch (err) {
        console.error('preview falló:', err);
      } finally {
        setBusy(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, image, actualW, actualH, targetW, targetH]);

  if (!open || !image) return null;

  const apply = async () => {
    const aw = parseFloat(actualW);
    const ah = parseFloat(actualH);
    const tw = parseFloat(targetW);
    const th = parseFloat(targetH);
    if (!Number.isFinite(aw) || !Number.isFinite(ah)
        || !Number.isFinite(tw) || !Number.isFinite(th)
        || aw <= 0 || ah <= 0 || tw <= 0 || th <= 0) {
      return;
    }
    setBusy(true);
    try {
      const out = await extendImageToSize(
        image.dataUrl,
        { w: aw, h: ah },
        { w: tw, h: th },
      );
      onSave?.({
        dataUrl: out.dataUrl,
        width: out.width,
        height: out.height,
        physicalSizeMm: out.sizeMm,
        // Las caras detectadas pueden ya no aplicar; las invalidamos.
        faces: [],
        autoZoomed: false,
      });
      onClose?.();
    } catch (err) {
      console.error('apply falló:', err);
    } finally {
      setBusy(false);
    }
  };

  // Helpers para mantener proporcion al cambiar uno de los inputs (opcional).
  const onActualWChange = (v) => {
    setActualW(v);
  };
  const onActualHChange = (v) => {
    setActualH(v);
  };

  // El SVG preview muestra: rect del tamanio actual (en mm) + rect del
  // tamanio target (con la imagen actual centrada).
  const aw = parseFloat(actualW) || 0;
  const ah = parseFloat(actualH) || 0;
  const tw = parseFloat(targetW) || 0;
  const th = parseFloat(targetH) || 0;
  const viewW = Math.max(tw, aw) * 1.4 + 4;
  const viewH = Math.max(th, ah) * 1.4 + 4;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="flex h-[80vh] max-h-[640px] w-[80vw] max-w-[1100px] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2">
          <h3 className="text-sm font-semibold text-ink-100 truncate" title={image.name}>
            Editar imagen — {image.name}
          </h3>
          <span className="text-[11px] text-ink-400">
            Archivo: {image.width} × {image.height} px
          </span>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 items-center justify-center bg-ink-950 p-4">
            {previewUrl ? (
              <div
                className="relative shadow-2xl"
                style={{
                  width: `${(tw / Math.max(viewW, 1)) * 100}%`,
                  aspectRatio: tw && th ? `${tw} / ${th}` : undefined,
                  maxHeight: '100%',
                  maxWidth: '100%',
                }}
              >
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="h-full w-full object-fill"
                  draggable={false}
                />
                {/* Marco interno: tamanio actual */}
                {aw > 0 && ah > 0 && tw > 0 && th > 0 && (
                  <div
                    className="pointer-events-none absolute border border-cyan-400/80"
                    style={{
                      left: `${((tw - aw) / 2 / tw) * 100}%`,
                      top: `${((th - ah) / 2 / th) * 100}%`,
                      width: `${(aw / tw) * 100}%`,
                      height: `${(ah / th) * 100}%`,
                    }}
                  />
                )}
              </div>
            ) : (
              <span className="text-xs text-ink-400">Generando preview…</span>
            )}
          </div>

          <div className="w-72 shrink-0 space-y-4 border-l border-ink-700 bg-ink-900 p-4">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-300">
                Tamaño actual de la imagen
              </h4>
              <p className="mt-1 text-[11px] text-ink-400">
                Lo que mide hoy en mm. La app no lo sabe; decímelo vos.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] text-ink-400">
                  Ancho mm
                  <input
                    type="number"
                    step="0.1"
                    value={actualW}
                    onChange={(e) => onActualWChange(e.target.value)}
                    className="mt-1 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
                <label className="text-[11px] text-ink-400">
                  Alto mm
                  <input
                    type="number"
                    step="0.1"
                    value={actualH}
                    onChange={(e) => onActualHChange(e.target.value)}
                    className="mt-1 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-300">
                Tamaño objetivo
              </h4>
              <p className="mt-1 text-[11px] text-ink-400">
                A qué tamaño querés llevarla. Los bordes faltantes se rellenan con edge replicate.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] text-ink-400">
                  Ancho mm
                  <input
                    type="number"
                    step="0.1"
                    value={targetW}
                    onChange={(e) => setTargetW(e.target.value)}
                    className="mt-1 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
                <label className="text-[11px] text-ink-400">
                  Alto mm
                  <input
                    type="number"
                    step="0.1"
                    value={targetH}
                    onChange={(e) => setTargetH(e.target.value)}
                    className="mt-1 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
              </div>
            </div>

            <div className="rounded border border-ink-700 bg-ink-800 p-2 text-[11px] text-ink-400">
              <div className="mb-1 flex items-center gap-1">
                <span className="inline-block h-2 w-2 border border-cyan-400" />
                <span>Marco celeste = tamaño original (centrado).</span>
              </div>
              <div>Lo que rodea ese marco es bleed agregado.</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-700 px-4 py-2">
          <button
            onClick={onClose}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
          >
            Cancelar
          </button>
          <button
            onClick={apply}
            disabled={busy}
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-50"
          >
            {busy ? 'Procesando…' : 'Aplicar'}
          </button>
        </div>
      </div>
    </div>
  );
}
