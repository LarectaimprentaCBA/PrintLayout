import { useEffect, useMemo, useRef, useState } from 'react';
import { extendWithMethod, sampleColorAt } from '../lib/imageBleed.js';
import { cutRectForCell, bleedMmForCell, safetyMm, cellsHomogeneous } from '../lib/templates.js';

// Editor por imagen con sangrado/corte/zona segura. Toma medidas de la
// plantilla activa (primera celda como referencia, asumiendo celdas
// homogeneas — caso de tarjetas).
//
// Props:
//   open, image, template, onSave, onClose, onTemplateSafetyChange
//
// onSave(updates): { dataUrl, width, height, physicalSizeMm, faces, autoZoomed }
// onTemplateSafetyChange(mm): se llama cuando el usuario cambia safetyMm.
export default function ImageEditorModal({
  open,
  image,
  template,
  onSave,
  onClose,
  onTemplateSafetyChange,
}) {
  // Tamano declarado y target en mm (strings para inputs).
  const [actualW, setActualW] = useState('');
  const [actualH, setActualH] = useState('');
  const [targetW, setTargetW] = useState('');
  const [targetH, setTargetH] = useState('');

  // Metodo y opciones.
  const [method, setMethod] = useState('mirror');
  const [stripPx, setStripPx] = useState(8);
  const [color, setColor] = useState('#ffffff');
  const [shrinkPercent, setShrinkPercent] = useState(90);
  const [shrinkFillMode, setShrinkFillMode] = useState('mirror');
  const [centerRectMm, setCenterRectMm] = useState(null);
  const [cropPercent, setCropPercent] = useState(0);

  // Estado de UI.
  const [previewUrl, setPreviewUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pickingColor, setPickingColor] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const [draggingHandle, setDraggingHandle] = useState(null); // null | 'tl' | 'tr' | 'bl' | 'br' | 'move'
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef(null);
  const debounceRef = useRef(null);
  const safetyDebounceRef = useRef(null);
  const previewBoxRef = useRef(null);

  // Datos derivados de la plantilla.
  const refCell = template?.celdas?.[0] ?? null;
  const homogeneous = useMemo(() => cellsHomogeneous(template), [template]);
  const cutRect = refCell ? cutRectForCell(template, refCell) : null;
  const bleedSides = refCell ? bleedMmForCell(template, refCell) : null;
  const safetyValue = safetyMm(template);
  const [safetyInput, setSafetyInput] = useState(String(safetyValue));

  useEffect(() => {
    setSafetyInput(String(safetyValue));
  }, [safetyValue, template?.id]);

  const aspectFromImg = image ? image.width / image.height : 1;

  // Inicializar al abrir.
  useEffect(() => {
    if (!open || !image) return;
    // physicalSizeMm es confiable cuando es cercano al tamano de celda (caso
    // JPG con DPI valido). Si excede al target por > 50%, viene de un PDF que
    // tenia la imagen renderizada a tamano gigante — no representa la tarjeta.
    const phys = image.physicalSizeMm;
    const physReasonable = phys && refCell
      && phys.w <= refCell.w * 1.5
      && phys.h <= refCell.h * 1.5;
    if (physReasonable) {
      setActualW(phys.w.toFixed(1));
      setActualH(phys.h.toFixed(1));
    } else if (cutRect) {
      setActualW(cutRect.w.toFixed(1));
      setActualH(cutRect.h.toFixed(1));
    } else if (refCell) {
      setActualW(refCell.w.toFixed(1));
      setActualH(refCell.h.toFixed(1));
    } else if (phys) {
      // Sin plantilla pero con DPI: usar el DPI (caso edicion suelto).
      setActualW(phys.w.toFixed(1));
      setActualH(phys.h.toFixed(1));
    } else {
      const defaultW = 50;
      const defaultH = defaultW / aspectFromImg;
      setActualW(defaultW.toFixed(1));
      setActualH(defaultH.toFixed(1));
    }
    if (refCell) {
      setTargetW(refCell.w.toFixed(1));
      setTargetH(refCell.h.toFixed(1));
    } else if (image.physicalSizeMm) {
      setTargetW(String(image.physicalSizeMm.w));
      setTargetH(String(image.physicalSizeMm.h));
    } else {
      setTargetW('50');
      setTargetH((50 / aspectFromImg).toFixed(1));
    }
    // Snap a corte por defecto: si hay cutRect detectado, abrimos en modo
    // shrinkBleed con el % calculado para que el contenido caiga sobre el corte.
    // Si no hay corte, default a mirror (mas natural para fotos sin plantilla).
    if (cutRect && refCell) {
      const snapPct = Math.max(cutRect.w / refCell.w, cutRect.h / refCell.h) * 100;
      setMethod('shrinkBleed');
      setShrinkPercent(Math.round(snapPct));
      setShrinkFillMode('mirror');
    } else {
      setMethod('mirror');
      setShrinkPercent(90);
      setShrinkFillMode('mirror');
    }
    setStripPx(8);
    setColor('#ffffff');
    setCenterRectMm(null);
    setPickingColor(false);
    setShowGuides(true);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [open, image?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const aw = parseFloat(actualW) || 0;
  const ah = parseFloat(actualH) || 0;
  const tw = parseFloat(targetW) || 0;
  const th = parseFloat(targetH) || 0;

  // Inicializa centerRectMm cuando se entra a 9-slice por primera vez (default
  // = 60% central del area declarada).
  useEffect(() => {
    if (method !== 'nineSlice') return;
    if (centerRectMm) return;
    if (aw <= 0 || ah <= 0) return;
    setCenterRectMm({
      x: aw * 0.2,
      y: ah * 0.2,
      w: aw * 0.6,
      h: ah * 0.6,
    });
  }, [method, aw, ah, centerRectMm]);

  // Generar preview con debounce.
  useEffect(() => {
    if (!open || !image) return;
    if (aw <= 0 || ah <= 0 || tw <= 0 || th <= 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setBusy(true);
      try {
        const cfg = methodConfig({
          method, stripPx, color, shrinkPercent, shrinkFillMode, centerRectMm, cropPercent,
        });
        const out = await extendWithMethod(
          image.dataUrl,
          { w: aw, h: ah },
          { w: tw, h: th },
          cfg,
        );
        setPreviewUrl(out.dataUrl);
      } catch (err) {
        console.error('preview fallo:', err);
      } finally {
        setBusy(false);
      }
    }, 200);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [open, image, aw, ah, tw, th, method, stripPx, color, shrinkPercent, shrinkFillMode, centerRectMm, cropPercent]);

  if (!open || !image) return null;

  const apply = async () => {
    if (aw <= 0 || ah <= 0 || tw <= 0 || th <= 0) return;
    setBusy(true);
    try {
      const cfg = methodConfig({
        method, stripPx, color, shrinkPercent, shrinkFillMode, centerRectMm, cropPercent,
      });
      const out = await extendWithMethod(
        image.dataUrl,
        { w: aw, h: ah },
        { w: tw, h: th },
        cfg,
      );
      onSave?.({
        dataUrl: out.dataUrl,
        width: out.width,
        height: out.height,
        physicalSizeMm: out.sizeMm,
        faces: [],
        autoZoomed: false,
      });
      onClose?.();
    } catch (err) {
      console.error('apply fallo:', err);
    } finally {
      setBusy(false);
    }
  };

  // Bleed implicito en el target. Si el target = refCell.w/h y hay bleedSides,
  // los lados del target tienen ese mismo bleed (cut esta interior al target).
  // Si no, no se muestran overlays de corte/safety.
  const isCircleCut = template?.cutShape === 'circle';
  const showCutOverlay =
    !!bleedSides && !!refCell
    && Math.abs(tw - refCell.w) < 0.5
    && Math.abs(th - refCell.h) < 0.5;
  const cutInsetT = showCutOverlay ? bleedSides.top : 0;
  const cutInsetR = showCutOverlay ? bleedSides.right : 0;
  const cutInsetB = showCutOverlay ? bleedSides.bottom : 0;
  const cutInsetL = showCutOverlay ? bleedSides.left : 0;
  const cutW = tw - cutInsetL - cutInsetR;
  const cutH = th - cutInsetT - cutInsetB;
  const safetyVal = parseFloat(safetyInput);
  const safetyOk = Number.isFinite(safetyVal) && safetyVal >= 0;
  const sVal = safetyOk ? safetyVal : 0;
  // Para corte circular: el circulo va inscripto y centrado en la celda.
  // El radio del corte = min(tw,th)/2 - cutMargin del template (default 0).
  const cutMarginMm = Number(template?.cutMarginMm) || 0;
  const circleRadiusMm = Math.max(0, Math.min(tw, th) / 2 - cutMarginMm);
  const safetyCircleRadiusMm = Math.max(0, circleRadiusMm - sVal);

  // El frame del preview tiene aspect ratio tw:th. Convertir mm → % para overlays.
  const pct = (mm, total) => (total > 0 ? (mm / total) * 100 : 0);

  const onSafetyChange = (v) => {
    setSafetyInput(v);
    const n = parseFloat(v);
    if (!Number.isFinite(n) || n < 0 || !onTemplateSafetyChange) return;
    if (safetyDebounceRef.current) clearTimeout(safetyDebounceRef.current);
    safetyDebounceRef.current = setTimeout(() => {
      onTemplateSafetyChange(n);
    }, 500);
  };

  // Wheel: zoom in/out. Click-drag (cuando no es pipeta ni handle): pan.
  const onWheel = (e) => {
    // No usamos preventDefault porque React onWheel es passive; stopPropagation
    // alcanza porque el modal esta en overlay fijo y el body no scrollea visible.
    e.stopPropagation();
    const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
    setZoom((z) => {
      const next = Math.max(1, Math.min(8, z * factor));
      // Si volvemos a 1x, resetear pan tambien.
      if (next <= 1.001) {
        setPan({ x: 0, y: 0 });
        return 1;
      }
      return next;
    });
  };

  const onPanStart = (e) => {
    if (pickingColor || draggingHandle) return;
    if (zoom <= 1.001) return; // sin zoom no tiene sentido panear
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY, pan: { ...pan } };
  };

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e) => {
      if (!panStartRef.current) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan({
        x: panStartRef.current.pan.x + dx,
        y: panStartRef.current.pan.y + dy,
      });
    };
    const onUp = () => {
      setIsPanning(false);
      panStartRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [isPanning]);

  // Eyedropper: click sobre la imagen del preview samplea el pixel.
  const onPreviewClick = async (e) => {
    if (!pickingColor || !previewUrl) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const img = new Image();
    img.src = previewUrl;
    await new Promise((r) => { img.onload = r; });
    const px = (x / rect.width) * img.naturalWidth;
    const py = (y / rect.height) * img.naturalHeight;
    try {
      const sampled = await sampleColorAt(previewUrl, px, py);
      setColor(sampled);
      setPickingColor(false);
    } catch (err) {
      console.error('sample fallo:', err);
    }
  };

  // 9-slice: handlers para arrastrar las 4 esquinas del rect central.
  const onHandlePointerDown = (which) => (e) => {
    e.stopPropagation();
    setDraggingHandle(which);
  };

  useEffect(() => {
    if (!draggingHandle) return;
    const onMove = (e) => {
      const box = previewBoxRef.current;
      if (!box || !centerRectMm) return;
      const rect = box.getBoundingClientRect();
      const xPx = e.clientX - rect.left;
      const yPx = e.clientY - rect.top;
      // Mapear pixel del frame al espacio del area declarada (srcSizeMm).
      // 1) Posicion del mouse en mm dentro del frame (target).
      // 2) Restar el offset del area fitteada (declared image en frame).
      // 3) Dividir por fitScale para volver al espacio srcSizeMm.
      const fs = fitScale || 1;
      const declOffX = Math.max(0, (tw - aw * fs) / 2);
      const declOffY = Math.max(0, (th - ah * fs) / 2);
      const offsetXmm = ((xPx / rect.width) * tw - declOffX) / fs;
      const offsetYmm = ((yPx / rect.height) * th - declOffY) / fs;
      setCenterRectMm((prev) => {
        if (!prev) return prev;
        let { x, y, w, h } = prev;
        const cx2 = x + w;
        const cy2 = y + h;
        const minSize = 2;
        if (draggingHandle === 'tl') {
          x = Math.max(0, Math.min(cx2 - minSize, offsetXmm));
          y = Math.max(0, Math.min(cy2 - minSize, offsetYmm));
          w = cx2 - x;
          h = cy2 - y;
        } else if (draggingHandle === 'tr') {
          y = Math.max(0, Math.min(cy2 - minSize, offsetYmm));
          w = Math.max(minSize, Math.min(aw - x, offsetXmm - x));
          h = cy2 - y;
        } else if (draggingHandle === 'bl') {
          x = Math.max(0, Math.min(cx2 - minSize, offsetXmm));
          w = cx2 - x;
          h = Math.max(minSize, Math.min(ah - y, offsetYmm - y));
        } else if (draggingHandle === 'br') {
          w = Math.max(minSize, Math.min(aw - x, offsetXmm - x));
          h = Math.max(minSize, Math.min(ah - y, offsetYmm - y));
        }
        return { x, y, w, h };
      });
    };
    const onUp = () => setDraggingHandle(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingHandle, centerRectMm, aw, ah, tw, th]);

  // Si la imagen declarada excede el target, se encoge para que entre. El
  // rect celeste punteado muestra el area REAL que ocupa la imagen despues
  // del fit (sino se sale del marco).
  const fitScale = aw > 0 && ah > 0 && tw > 0 && th > 0
    ? Math.min(1, tw / aw, th / ah)
    : 1;
  const fittedAw = aw * fitScale;
  const fittedAh = ah * fitScale;
  const declaredOffsetX = Math.max(0, (tw - fittedAw) / 2);
  const declaredOffsetY = Math.max(0, (th - fittedAh) / 2);

  // Conversion centerRectMm (relativo a srcSizeMm) → coords del frame (target).
  // Aplicamos fitScale porque el espacio declarado se renderiza encogido
  // cuando excede el target.
  const center9Frame = centerRectMm
    ? {
        x: declaredOffsetX + centerRectMm.x * fitScale,
        y: declaredOffsetY + centerRectMm.y * fitScale,
        w: centerRectMm.w * fitScale,
        h: centerRectMm.h * fitScale,
      }
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div className="flex h-[88vh] max-h-[760px] w-[92vw] max-w-[1280px] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2">
          <h3 className="text-sm font-semibold text-ink-100 truncate" title={image.name}>
            Editar imagen — {image.name}
          </h3>
          <span className="text-[11px] text-ink-400">
            Archivo: {image.width} × {image.height} px
          </span>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Preview */}
          <div className="flex flex-1 items-center justify-center bg-ink-950 p-6">
            {previewUrl && tw > 0 && th > 0 ? (
              <div
                className="relative shadow-2xl overflow-hidden"
                onWheel={onWheel}
                onPointerDown={onPanStart}
                style={{
                  aspectRatio: `${tw} / ${th}`,
                  maxHeight: '100%',
                  maxWidth: '100%',
                  height: '100%',
                  width: 'auto',
                  cursor: pickingColor
                    ? 'crosshair'
                    : isPanning
                      ? 'grabbing'
                      : zoom > 1.001
                        ? 'grab'
                        : 'default',
                }}
              >
                <div
                  ref={previewBoxRef}
                  className="absolute inset-0"
                  onClick={onPreviewClick}
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'center',
                  }}
                >
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="h-full w-full object-fill"
                  draggable={false}
                />

                {showGuides && (
                  <>
                    {/* Marco celda completa (= todo el target) */}
                    <div className="pointer-events-none absolute inset-0 border border-cyan-400/70" />

                    {/* Linea de corte */}
                    {showCutOverlay && !isCircleCut && (
                      <div
                        className="pointer-events-none absolute border-2 border-red-500"
                        style={{
                          left: `${pct(cutInsetL, tw)}%`,
                          top: `${pct(cutInsetT, th)}%`,
                          right: `${pct(cutInsetR, tw)}%`,
                          bottom: `${pct(cutInsetB, th)}%`,
                        }}
                      />
                    )}
                    {showCutOverlay && isCircleCut && circleRadiusMm > 0 && (
                      <svg
                        className="pointer-events-none absolute inset-0 h-full w-full"
                        viewBox={`0 0 ${tw} ${th}`}
                        preserveAspectRatio="none"
                      >
                        {/* Tinta oscura afuera del corte, agujero circular en el medio. */}
                        <path
                          d={`M0,0 L${tw},0 L${tw},${th} L0,${th} Z `
                            + `M${tw / 2},${th / 2 - circleRadiusMm} `
                            + `A${circleRadiusMm},${circleRadiusMm} 0 1 0 ${tw / 2},${th / 2 + circleRadiusMm} `
                            + `A${circleRadiusMm},${circleRadiusMm} 0 1 0 ${tw / 2},${th / 2 - circleRadiusMm} Z`}
                          fillRule="evenodd"
                          fill="rgba(0,0,0,0.65)"
                        />
                        <ellipse
                          cx={tw / 2}
                          cy={th / 2}
                          rx={circleRadiusMm}
                          ry={circleRadiusMm}
                          fill="none"
                          stroke="#ef4444"
                          strokeWidth={0.4}
                          vectorEffect="non-scaling-stroke"
                        />
                      </svg>
                    )}

                    {/* Zona segura (corte − safetyMm) */}
                    {showCutOverlay && !isCircleCut && safetyOk && sVal > 0 && (
                      <div
                        className="pointer-events-none absolute border border-dashed border-yellow-300"
                        style={{
                          left: `${pct(cutInsetL + sVal, tw)}%`,
                          top: `${pct(cutInsetT + sVal, th)}%`,
                          right: `${pct(cutInsetR + sVal, tw)}%`,
                          bottom: `${pct(cutInsetB + sVal, th)}%`,
                        }}
                      />
                    )}
                    {showCutOverlay && isCircleCut && safetyOk && sVal > 0 && safetyCircleRadiusMm > 0 && (
                      <svg
                        className="pointer-events-none absolute inset-0 h-full w-full"
                        viewBox={`0 0 ${tw} ${th}`}
                        preserveAspectRatio="none"
                      >
                        <ellipse
                          cx={tw / 2}
                          cy={th / 2}
                          rx={safetyCircleRadiusMm}
                          ry={safetyCircleRadiusMm}
                          fill="none"
                          stroke="#fde047"
                          strokeWidth={0.25}
                          strokeDasharray="0.8 0.8"
                          vectorEffect="non-scaling-stroke"
                        />
                      </svg>
                    )}

                    {/* Marco del area que ocupa la imagen (cyan punteado).
                        Usa el area fitteada si la imagen excede el target. */}
                    {fittedAw > 0 && fittedAh > 0 && tw > 0 && th > 0 && (fittedAw !== tw || fittedAh !== th) && (
                      <div
                        className="pointer-events-none absolute border border-dashed border-cyan-300/60"
                        style={{
                          left: `${pct(declaredOffsetX, tw)}%`,
                          top: `${pct(declaredOffsetY, th)}%`,
                          width: `${pct(fittedAw, tw)}%`,
                          height: `${pct(fittedAh, th)}%`,
                        }}
                      />
                    )}
                  </>
                )}

                {/* 9-slice: rect central + handles */}
                {method === 'nineSlice' && center9Frame && (
                  <>
                    <div
                      className="pointer-events-none absolute border-2 border-fuchsia-400"
                      style={{
                        left: `${pct(center9Frame.x, tw)}%`,
                        top: `${pct(center9Frame.y, th)}%`,
                        width: `${pct(center9Frame.w, tw)}%`,
                        height: `${pct(center9Frame.h, th)}%`,
                      }}
                    />
                    {['tl', 'tr', 'bl', 'br'].map((h) => {
                      const hx = h.includes('r') ? center9Frame.x + center9Frame.w : center9Frame.x;
                      const hy = h.includes('b') ? center9Frame.y + center9Frame.h : center9Frame.y;
                      return (
                        <div
                          key={h}
                          onPointerDown={onHandlePointerDown(h)}
                          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-fuchsia-400 bg-ink-900"
                          style={{
                            left: `${pct(hx, tw)}%`,
                            top: `${pct(hy, th)}%`,
                          }}
                        />
                      );
                    })}
                  </>
                )}
                </div>

                {/* Badge de zoom (fuera del area transformada) */}
                <div className="pointer-events-auto absolute bottom-2 right-2 flex items-center gap-1 rounded bg-ink-900/80 px-2 py-1 text-[10px] text-ink-200 backdrop-blur">
                  <button
                    onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.max(1, z / 1.5)); if (zoom / 1.5 <= 1.001) setPan({ x: 0, y: 0 }); }}
                    className="rounded px-1 hover:bg-ink-700"
                    title="Zoom out"
                  >−</button>
                  <span className="min-w-[3em] text-center">{(zoom * 100).toFixed(0)}%</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.min(8, z * 1.5)); }}
                    className="rounded px-1 hover:bg-ink-700"
                    title="Zoom in"
                  >+</button>
                  {zoom > 1.001 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setZoom(1); setPan({ x: 0, y: 0 }); }}
                      className="rounded px-1 hover:bg-ink-700"
                      title="Reset"
                    >×</button>
                  )}
                </div>
              </div>
            ) : (
              <span className="text-xs text-ink-400">Generando preview…</span>
            )}
          </div>

          {/* Panel de controles */}
          <div className="w-80 shrink-0 space-y-3 overflow-y-auto border-l border-ink-700 bg-ink-900 p-3">
            {/* Plantilla activa */}
            {template ? (
              <div className="rounded border border-ink-700 bg-ink-800/60 p-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-300">
                    Plantilla
                  </h4>
                  <button
                    onClick={() => {
                      if (refCell) {
                        setTargetW(refCell.w.toFixed(1));
                        setTargetH(refCell.h.toFixed(1));
                      }
                    }}
                    className="rounded border border-ink-700 px-2 py-0.5 text-[10px] text-ink-200 hover:bg-ink-700"
                    title="Resetea el tamaño objetivo a la celda de la plantilla"
                  >
                    Target = celda
                  </button>
                </div>
                <p className="mt-1 truncate text-[11px] text-ink-100" title={template.name}>
                  {template.name}
                </p>
                {refCell && (
                  <p className="text-[10px] text-ink-400">
                    Celda: {refCell.w.toFixed(1)} × {refCell.h.toFixed(1)} mm
                    {!homogeneous && ' · celdas heterogéneas'}
                  </p>
                )}
                {cutRect && (
                  <p className="text-[10px] text-ink-400">
                    Corte: {cutRect.w.toFixed(1)} × {cutRect.h.toFixed(1)} mm
                  </p>
                )}
                {bleedSides && (
                  <p className="text-[10px] text-ink-400">
                    Bleed: T {bleedSides.top.toFixed(1)} · R {bleedSides.right.toFixed(1)} · B {bleedSides.bottom.toFixed(1)} · L {bleedSides.left.toFixed(1)} mm
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded border border-ink-700 bg-ink-800/60 p-2 text-[11px] text-ink-400">
                Sin plantilla activa. Cargá una plantilla para ver corte y zona segura.
              </div>
            )}

            {/* Tamano actual */}
            <div>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-300">
                  Tamaño actual
                </h4>
                {image.physicalSizeMm && (
                  <button
                    onClick={() => {
                      setActualW(image.physicalSizeMm.w.toFixed(1));
                      setActualH(image.physicalSizeMm.h.toFixed(1));
                    }}
                    className="rounded border border-ink-700 px-2 py-0.5 text-[10px] text-ink-200 hover:bg-ink-700"
                    title="Usa el tamaño físico que viene en los metadatos DPI del archivo"
                  >
                    Del archivo
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-[10px] text-ink-500">
                {image.physicalSizeMm
                  ? `Archivo: ${image.physicalSizeMm.w.toFixed(1)} × ${image.physicalSizeMm.h.toFixed(1)} mm (DPI)`
                  : 'Cuánto mide hoy la imagen del cliente, en mm.'}
              </p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <label className="text-[10px] text-ink-400">
                  Ancho mm
                  <input
                    type="number" step="0.1"
                    value={actualW}
                    onChange={(e) => setActualW(e.target.value)}
                    className="mt-0.5 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
                <label className="text-[10px] text-ink-400">
                  Alto mm
                  <input
                    type="number" step="0.1"
                    value={actualH}
                    onChange={(e) => setActualH(e.target.value)}
                    className="mt-0.5 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
              </div>
            </div>

            {/* Tamano objetivo */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-300">
                Tamaño objetivo
              </h4>
              <p className="mt-0.5 text-[10px] text-ink-500">
                A qué tamaño total (con sangrado) llevarla.
              </p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <label className="text-[10px] text-ink-400">
                  Ancho mm
                  <input
                    type="number" step="0.1"
                    value={targetW}
                    onChange={(e) => setTargetW(e.target.value)}
                    className="mt-0.5 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
                <label className="text-[10px] text-ink-400">
                  Alto mm
                  <input
                    type="number" step="0.1"
                    value={targetH}
                    onChange={(e) => setTargetH(e.target.value)}
                    className="mt-0.5 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
              </div>
            </div>

            {/* Metodo */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-300">
                Método de relleno
              </h4>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="mt-1 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
              >
                <option value="mirror">Espejo (recomendado)</option>
                <option value="replicate">Edge replicate (franja)</option>
                <option value="color">Color sólido</option>
                <option value="nineSlice">9-slice (centro fijo)</option>
                <option value="shrinkBleed">Encoger + bleed</option>
                <option value="crop">Recortar bordes (zoom)</option>
              </select>

              {method === 'crop' && (
                <div className="mt-2">
                  <label className="text-[10px] text-ink-400">
                    Recortar: {cropPercent}% (la imagen se agranda y los bordes caen afuera del corte)
                    <input
                      type="range" min="0" max="50" step="1"
                      value={cropPercent}
                      onChange={(e) => setCropPercent(parseInt(e.target.value, 10))}
                      className="mt-0.5 w-full"
                    />
                  </label>
                </div>
              )}

              {method === 'replicate' && (
                <div className="mt-2">
                  <label className="text-[10px] text-ink-400">
                    Ancho de franja: {stripPx} px
                    <input
                      type="range" min="2" max="32" step="1"
                      value={stripPx}
                      onChange={(e) => setStripPx(parseInt(e.target.value, 10))}
                      className="mt-0.5 w-full"
                    />
                  </label>
                </div>
              )}

              {method === 'color' && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-7 w-12 cursor-pointer rounded border border-ink-700 bg-ink-800"
                  />
                  <input
                    type="text"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="flex-1 rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-100"
                  />
                  <button
                    onClick={() => setPickingColor(!pickingColor)}
                    className={`rounded border px-2 py-1 text-[10px] ${
                      pickingColor
                        ? 'border-accent-500 bg-accent-500/20 text-accent-300'
                        : 'border-ink-700 text-ink-200 hover:bg-ink-800'
                    }`}
                    title="Pipeta: click sobre el preview para samplear color"
                  >
                    Pipeta
                  </button>
                </div>
              )}

              {method === 'nineSlice' && centerRectMm && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] text-ink-500">
                    Arrastrá las esquinas magenta del preview para definir el área central que NO se debe deformar.
                  </p>
                  <div className="grid grid-cols-2 gap-1 text-[10px] text-ink-400">
                    <span>X: {centerRectMm.x.toFixed(1)} mm</span>
                    <span>Y: {centerRectMm.y.toFixed(1)} mm</span>
                    <span>W: {centerRectMm.w.toFixed(1)} mm</span>
                    <span>H: {centerRectMm.h.toFixed(1)} mm</span>
                  </div>
                </div>
              )}

              {method === 'shrinkBleed' && (
                <div className="mt-2 space-y-2">
                  <label className="block text-[10px] text-ink-400">
                    Encoger contenido: {shrinkPercent}%
                    <input
                      type="range" min="10" max="100" step="1"
                      value={shrinkPercent}
                      onChange={(e) => setShrinkPercent(parseInt(e.target.value, 10))}
                      className="mt-0.5 w-full"
                    />
                  </label>
                  {cutRect && refCell && (
                    <button
                      onClick={() => {
                        const pct = Math.max(cutRect.w / refCell.w, cutRect.h / refCell.h) * 100;
                        setShrinkPercent(Math.round(pct));
                      }}
                      className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[10px] text-ink-200 hover:bg-ink-700"
                    >
                      Encajar al corte ({Math.round(Math.max(cutRect.w / refCell.w, cutRect.h / refCell.h) * 100)}%)
                    </button>
                  )}
                  <label className="block text-[10px] text-ink-400">
                    Rellenar bleed con
                    <select
                      value={shrinkFillMode}
                      onChange={(e) => setShrinkFillMode(e.target.value)}
                      className="mt-0.5 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-100 outline-none focus:border-accent-500"
                    >
                      <option value="mirror">Espejo</option>
                      <option value="replicate">Edge replicate</option>
                      <option value="color">Color sólido</option>
                      <option value="nineSlice">9-slice (centro fijo)</option>
                    </select>
                  </label>
                  {shrinkFillMode === 'color' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        className="h-7 w-12 cursor-pointer rounded border border-ink-700 bg-ink-800"
                      />
                      <input
                        type="text"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        className="flex-1 rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-100"
                      />
                    </div>
                  )}
                  {shrinkFillMode === 'replicate' && (
                    <label className="block text-[10px] text-ink-400">
                      Franja: {stripPx} px
                      <input
                        type="range" min="2" max="32" step="1"
                        value={stripPx}
                        onChange={(e) => setStripPx(parseInt(e.target.value, 10))}
                        className="mt-0.5 w-full"
                      />
                    </label>
                  )}
                </div>
              )}
            </div>

            {/* Zona segura */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-300">
                Zona segura
              </h4>
              <p className="mt-0.5 text-[10px] text-ink-500">
                Distancia interior al corte donde no debería caer contenido importante.
              </p>
              <label className="mt-1 block text-[10px] text-ink-400">
                Margen mm (por plantilla)
                <input
                  type="number" step="0.5" min="0"
                  value={safetyInput}
                  onChange={(e) => onSafetyChange(e.target.value)}
                  className="mt-0.5 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
                />
              </label>
            </div>

            {/* Toggle guias */}
            <label className="flex cursor-pointer items-center gap-2 rounded border border-ink-700 bg-ink-800/60 px-2 py-1.5 text-[11px] text-ink-200">
              <input
                type="checkbox"
                checked={showGuides}
                onChange={(e) => setShowGuides(e.target.checked)}
                className="cursor-pointer"
              />
              Mostrar guías (corte / zona segura)
            </label>

            {showGuides && showCutOverlay && (
              <div className="rounded border border-ink-700 bg-ink-800/60 p-2 text-[10px] text-ink-400 space-y-0.5">
                <div className="flex items-center gap-1">
                  <span className="inline-block h-2 w-3 border border-cyan-400/70" /> Borde celda (área impresa)
                </div>
                <div className="flex items-center gap-1">
                  <span className="inline-block h-2 w-3 border-2 border-red-500" /> Línea de corte
                </div>
                <div className="flex items-center gap-1">
                  <span className="inline-block h-2 w-3 border border-dashed border-yellow-300" /> Zona segura
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-ink-700 px-4 py-2">
          <span className="text-[11px] text-ink-500">
            {busy ? 'Procesando…' : 'Live preview con cambios'}
          </span>
          <div className="flex gap-2">
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
    </div>
  );
}

function methodConfig({ method, stripPx, color, shrinkPercent, shrinkFillMode, centerRectMm, cropPercent }) {
  switch (method) {
    case 'replicate':
      return { method, stripPx };
    case 'color':
      return { method, color };
    case 'nineSlice':
      return { method, centerRectMm };
    case 'shrinkBleed':
      return {
        method,
        shrinkPercent,
        fillMode: shrinkFillMode,
        fillOptions: shrinkFillMode === 'color' ? { color } : { stripPx },
      };
    case 'crop':
      return { method, cropPercent };
    case 'mirror':
    default:
      return { method: 'mirror' };
  }
}
