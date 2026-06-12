import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cropRectFromDataUrl,
  cropPolygonFromDataUrl,
  cropEllipseFromDataUrl,
  detectUniformBorder,
} from '../lib/imageCropTools.js';

// Modal de recorte manual de una imagen del sidebar. Modos:
//   - Rectangular: bbox con handles + boton "Detectar borde".
//   - Circulo: elipse inscrita en el bbox (cuadrado = circulo, rect = ovalo).
//   - Libre (poligonal): poligono con vertices arrastrables.
// Al aplicar se reemplaza dataUrl/width/height de la imagen (no reversible).

// Solo las esquinas tienen handles visibles (resize 2D). Los lados se
// agarran desde cualquier punto del borde via barras invisibles (resize 1D).
const CORNER_KEYS = ['nw', 'ne', 'se', 'sw'];
const SIDE_KEYS = ['n', 's', 'e', 'w'];

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export default function ImageCropModal({ open, image, onApply, onClose }) {
  const W = image?.width ?? 0;
  const H = image?.height ?? 0;

  const [mode, setMode] = useState('rect'); // 'rect' | 'poly'
  const [rect, setRect] = useState(null); // {x,y,w,h} en px de la imagen
  const [poly, setPoly] = useState([]); // [{x,y}, ...] en px
  const [polyClosed, setPolyClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detectResult, setDetectResult] = useState(null); // 'ok' | 'fail' | null
  const [error, setError] = useState(null);

  // Zoom y pan del viewport. zoom=1 = fit-to-screen.
  // pan en pixeles del viewport (DOM).
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const svgRef = useRef(null);
  const viewportRef = useRef(null);
  // Estado de drag in-flight para handles/move/vertices.
  const dragRef = useRef(null);
  // Estado de pan in-flight (middle-click drag).
  const panRef = useRef(null);

  // Reset cuando abre o cambia la imagen.
  useEffect(() => {
    if (!open || !image) return;
    setMode('rect');
    setRect({ x: 0, y: 0, w: W, h: H });
    // Poligono inicial: 4 esquinas (rect completo).
    setPoly([
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ]);
    setPolyClosed(true);
    setDetectResult(null);
    setError(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [open, image?.id, W, H]);

  // Wheel = zoom centrado en el cursor. Limitamos zoom a [1, 8].
  // Con transform-origin: center, las formulas usan offsets relativos al
  // centro del viewport.
  function handleWheel(e) {
    e.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rectVp = viewport.getBoundingClientRect();
    const u = e.clientX - rectVp.left - rectVp.width / 2;
    const v = e.clientY - rectVp.top - rectVp.height / 2;
    const delta = -Math.sign(e.deltaY) * 0.18;
    const next = Math.max(1, Math.min(8, zoom * (1 + delta)));
    if (Math.abs(next - zoom) < 0.001) return;
    const k = next / zoom;
    // Mantenemos el punto bajo el cursor fijo: pan' = u*(1-k) + k*pan
    setPan({ x: u * (1 - k) + k * pan.x, y: v * (1 - k) + k * pan.y });
    setZoom(next);
  }

  // Pan: middle-click drag o left-click drag sobre el fondo. Si estamos
  // agregando puntos del poligono (poly abierto), left-click no hace pan
  // — deja pasar el click para que onSvgClick agregue el vertice. Los
  // handles del rect / vertices del poligono hacen stopPropagation en sus
  // onPointerDown, asi que un click sobre ellos nunca llega aca.
  function handleViewportPointerDown(e) {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 0 && mode === 'poly' && !polyClosed) return;
    if (e.button === 1) e.preventDefault();
    panRef.current = {
      startMouse: { x: e.clientX, y: e.clientY },
      startPan: { ...pan },
    };
    window.addEventListener('pointermove', onPanMove);
    window.addEventListener('pointerup', onPanUp);
  }

  function onPanMove(e) {
    const p = panRef.current;
    if (!p) return;
    setPan({
      x: p.startPan.x + (e.clientX - p.startMouse.x),
      y: p.startPan.y + (e.clientY - p.startMouse.y),
    });
  }

  function onPanUp() {
    panRef.current = null;
    window.removeEventListener('pointermove', onPanMove);
    window.removeEventListener('pointerup', onPanUp);
  }

  // Botones de zoom: zoom centrado en el viewport (u=0, v=0).
  function zoomBy(factor) {
    const next = Math.max(1, Math.min(8, zoom * factor));
    if (Math.abs(next - zoom) < 0.001) return;
    const k = next / zoom;
    setPan({ x: k * pan.x, y: k * pan.y });
    setZoom(next);
  }

  function resetZoom() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  // Coordenadas del puntero -> coordenadas SVG (px imagen).
  function pointerToImage(e) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inv = ctm.inverse();
    const p = pt.matrixTransform(inv);
    return { x: p.x, y: p.y };
  }

  function startMoveRect(e) {
    if (e.button !== 0) return; // dejar pasar middle/right click al viewport
    e.preventDefault();
    e.stopPropagation();
    const p = pointerToImage(e);
    dragRef.current = {
      type: 'rectMove',
      startMouse: p,
      startRect: { ...rect },
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  function startResizeRect(e, handle) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const p = pointerToImage(e);
    dragRef.current = {
      type: 'rectResize',
      handle,
      startMouse: p,
      startRect: { ...rect },
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  function startDragVertex(e, idx) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type: 'polyVertex', idx };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const p = pointerToImage(e);
    if (d.type === 'rectMove') {
      const dx = p.x - d.startMouse.x;
      const dy = p.y - d.startMouse.y;
      const nx = clamp(d.startRect.x + dx, 0, W - d.startRect.w);
      const ny = clamp(d.startRect.y + dy, 0, H - d.startRect.h);
      setRect({ x: nx, y: ny, w: d.startRect.w, h: d.startRect.h });
    } else if (d.type === 'rectResize') {
      const r = { ...d.startRect };
      const minSize = 4;
      let x1 = r.x;
      let y1 = r.y;
      let x2 = r.x + r.w;
      let y2 = r.y + r.h;
      if (d.handle.includes('w')) x1 = clamp(p.x, 0, x2 - minSize);
      if (d.handle.includes('e')) x2 = clamp(p.x, x1 + minSize, W);
      if (d.handle.includes('n')) y1 = clamp(p.y, 0, y2 - minSize);
      if (d.handle.includes('s')) y2 = clamp(p.y, y1 + minSize, H);
      setRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    } else if (d.type === 'polyVertex') {
      const nx = clamp(p.x, 0, W);
      const ny = clamp(p.y, 0, H);
      setPoly((prev) =>
        prev.map((pt, i) => (i === d.idx ? { x: nx, y: ny } : pt)),
      );
    }
  }

  function onPointerUp() {
    dragRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }

  // En modo poligonal "agregar puntos": click en area vacia agrega vertice.
  // Si se hace click cerca del primer vertice con >=3 puntos -> cerrar.
  function onSvgClick(e) {
    if (mode !== 'poly' || polyClosed) return;
    const p = pointerToImage(e);
    if (poly.length >= 3) {
      const first = poly[0];
      const dist = Math.hypot(p.x - first.x, p.y - first.y);
      const threshold = Math.max(W, H) * 0.03;
      if (dist < threshold) {
        setPolyClosed(true);
        return;
      }
    }
    setPoly((prev) => [...prev, { x: clamp(p.x, 0, W), y: clamp(p.y, 0, H) }]);
  }

  // Doble-click cierra el polígono cuando esta abierto.
  function onSvgDblClick(e) {
    if (mode !== 'poly' || polyClosed) return;
    if (poly.length >= 3) {
      e.preventDefault();
      setPolyClosed(true);
    }
  }

  // Click en una arista (cuando polyClosed) inserta un vertice nuevo.
  function onEdgeClick(e, segIdx) {
    if (!polyClosed) return;
    e.stopPropagation();
    const p = pointerToImage(e);
    setPoly((prev) => {
      const next = [...prev];
      next.splice(segIdx + 1, 0, { x: p.x, y: p.y });
      return next;
    });
  }

  // Doble-click sobre un vertice lo elimina (si quedan >= 3).
  function onVertexDblClick(e, idx) {
    e.stopPropagation();
    if (!polyClosed) return;
    setPoly((prev) => (prev.length <= 3 ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function handleDetectBorder() {
    if (!image) return;
    setBusy(true);
    setDetectResult(null);
    try {
      const found = await detectUniformBorder(image.dataUrl);
      if (found && found.w > 4 && found.h > 4) {
        setRect(found);
        setDetectResult('ok');
      } else {
        setDetectResult('fail');
      }
    } catch (err) {
      console.error('detectUniformBorder fallo:', err);
      setDetectResult('fail');
    } finally {
      setBusy(false);
    }
  }

  // Cuadrado centrado más grande que entra (para el círculo por defecto).
  function centeredSquare() {
    const side = Math.min(W, H);
    return { x: (W - side) / 2, y: (H - side) / 2, w: side, h: side };
  }

  // Entrar a modo círculo: si la selección es la imagen entera (o no hay),
  // arrancamos con un cuadrado centrado para que se vea un círculo lindo.
  function enterCircleMode() {
    setMode('circle');
    setRect((r) => {
      const isFull = !r || (r.x === 0 && r.y === 0 && r.w === W && r.h === H);
      return isFull ? centeredSquare() : r;
    });
  }

  function handleReset() {
    if (mode === 'rect') {
      setRect({ x: 0, y: 0, w: W, h: H });
      setDetectResult(null);
    } else if (mode === 'circle') {
      setRect(centeredSquare());
    } else {
      setPoly([
        { x: 0, y: 0 },
        { x: W, y: 0 },
        { x: W, y: H },
        { x: 0, y: H },
      ]);
      setPolyClosed(true);
    }
  }

  function handleStartPoly() {
    setPoly([]);
    setPolyClosed(false);
  }

  async function handleApply() {
    if (!image || busy) return;
    setBusy(true);
    setError(null);
    try {
      let result;
      if (mode === 'rect') {
        if (!rect || rect.w < 2 || rect.h < 2) {
          throw new Error('El rectángulo es demasiado chico.');
        }
        // Si el rect cubre toda la imagen, no hay cambio: cancelamos.
        if (rect.x === 0 && rect.y === 0 && rect.w === W && rect.h === H) {
          onClose?.();
          return;
        }
        result = await cropRectFromDataUrl(image.dataUrl, rect);
      } else if (mode === 'circle') {
        if (!rect || rect.w < 2 || rect.h < 2) {
          throw new Error('El círculo es demasiado chico.');
        }
        result = await cropEllipseFromDataUrl(image.dataUrl, rect);
      } else {
        if (!polyClosed || poly.length < 3) {
          throw new Error('Cerrá el polígono antes de aplicar.');
        }
        result = await cropPolygonFromDataUrl(image.dataUrl, poly);
      }
      // Escalado del physicalSizeMm: si la imagen tenia tamaño fisico, lo
      // adaptamos proporcionalmente al recorte.
      let physicalSizeMm = image.physicalSizeMm ?? null;
      if (physicalSizeMm && W > 0 && H > 0) {
        physicalSizeMm = {
          w: physicalSizeMm.w * (result.width / W),
          h: physicalSizeMm.h * (result.height / H),
        };
      }
      onApply?.({
        dataUrl: result.dataUrl,
        width: result.width,
        height: result.height,
        physicalSizeMm,
        // Recorte invalida la deteccion previa.
        faces: [],
        autoZoomed: false,
        coverCropRect: null,
        focalPoint: null,
      });
      onClose?.();
    } catch (err) {
      console.error('Crop fallo:', err);
      setError(err.message || 'No se pudo aplicar el recorte.');
    } finally {
      setBusy(false);
    }
  }

  const polyPointsAttr = useMemo(() => {
    if (!poly?.length) return '';
    return poly.map((p) => `${p.x},${p.y}`).join(' ');
  }, [poly]);

  if (!open || !image) return null;

  // Estilo del rect overlay (con mascara "hueco" via clipPath/fill-rule).
  const handleSize = Math.max(8, Math.min(W, H) * 0.012);
  const strokeWidth = Math.max(1.5, Math.min(W, H) * 0.0025);
  const vertexR = Math.max(6, Math.min(W, H) * 0.01);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-stretch bg-black/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="m-4 flex w-full flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-ink-700 px-4 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink-100">Recortar imagen</div>
            <div className="truncate text-xs text-ink-400" title={image.name}>
              {image.name} · {W}×{H}px
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-ink-700 bg-ink-950 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode('rect')}
              className={`rounded px-3 py-1 ${
                mode === 'rect'
                  ? 'bg-accent-600 text-white'
                  : 'text-ink-300 hover:bg-ink-800'
              }`}
            >
              Rectángulo
            </button>
            <button
              type="button"
              onClick={enterCircleMode}
              className={`rounded px-3 py-1 ${
                mode === 'circle'
                  ? 'bg-accent-600 text-white'
                  : 'text-ink-300 hover:bg-ink-800'
              }`}
            >
              Círculo
            </button>
            <button
              type="button"
              onClick={() => setMode('poly')}
              className={`rounded px-3 py-1 ${
                mode === 'poly'
                  ? 'bg-accent-600 text-white'
                  : 'text-ink-300 hover:bg-ink-800'
              }`}
            >
              Forma libre
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-ink-300 hover:bg-ink-800 hover:text-ink-100"
            title="Cancelar"
          >
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 bg-ink-950 px-4 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {mode === 'rect' ? (
              <>
                <button
                  type="button"
                  onClick={handleDetectBorder}
                  disabled={busy}
                  className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-ink-100 hover:border-accent-500 disabled:opacity-50"
                >
                  Detectar borde automáticamente
                </button>
                {detectResult === 'ok' && (
                  <span className="text-emerald-300">
                    Borde detectado, ajustá si hace falta.
                  </span>
                )}
                {detectResult === 'fail' && (
                  <span className="text-amber-300">
                    No se detectó un borde claro. Ajustalo a mano.
                  </span>
                )}
              </>
            ) : mode === 'circle' ? (
              <span className="text-ink-400">
                Arrastrá y redimensioná la selección. Cuadrado = círculo perfecto; rectángulo = óvalo. Lo de afuera queda transparente.
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleStartPoly}
                  className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-ink-100 hover:border-accent-500"
                >
                  Empezar polígono nuevo
                </button>
                <span className="text-ink-400">
                  {polyClosed
                    ? 'Arrastrá vértices. Click en arista = nuevo punto. Dobleclick en vértice = quitar.'
                    : poly.length === 0
                      ? 'Hacé clic para agregar puntos. Mínimo 3.'
                      : poly.length < 3
                        ? `Faltan ${3 - poly.length} punto${3 - poly.length === 1 ? '' : 's'} para poder cerrar.`
                        : 'Click cerca del primer punto (o doble click) para cerrar.'}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-md border border-ink-700 bg-ink-800 p-0.5">
              <button
                type="button"
                onClick={() => zoomBy(1 / 1.4)}
                disabled={zoom <= 1.001}
                className="rounded px-2 py-0.5 text-ink-300 hover:bg-ink-700 hover:text-ink-100 disabled:opacity-40"
                title="Alejar (también: scroll abajo)"
              >
                −
              </button>
              <button
                type="button"
                onClick={resetZoom}
                disabled={zoom <= 1.001 && pan.x === 0 && pan.y === 0}
                className="min-w-[3.5rem] rounded px-1 py-0.5 text-center text-ink-300 hover:bg-ink-700 hover:text-ink-100 disabled:opacity-40"
                title="Ajustar a la ventana"
              >
                {zoom.toFixed(1)}×
              </button>
              <button
                type="button"
                onClick={() => zoomBy(1.4)}
                disabled={zoom >= 7.99}
                className="rounded px-2 py-0.5 text-ink-300 hover:bg-ink-700 hover:text-ink-100 disabled:opacity-40"
                title="Acercar (también: scroll arriba)"
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-ink-300 hover:border-accent-500 hover:text-ink-100"
            >
              Restaurar
            </button>
          </div>
        </div>

        {/* Canvas area */}
        <div
          ref={viewportRef}
          className="relative flex flex-1 items-center justify-center overflow-hidden bg-[repeating-conic-gradient(#1a1d24_0%_25%,#0f1115_0%_50%)] bg-[length:24px_24px]"
          onWheel={handleWheel}
          onPointerDown={handleViewportPointerDown}
          style={{
            cursor: panRef.current
              ? 'grabbing'
              : zoom > 1 && !(mode === 'poly' && !polyClosed)
                ? 'grab'
                : 'default',
          }}
        >
          <div
            className="relative flex max-h-full max-w-full items-center justify-center p-4"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: panRef.current || dragRef.current ? 'none' : undefined,
            }}
          >
            <div className="relative">
              <img
                src={image.dataUrl}
                alt=""
                draggable={false}
                className="block max-h-[calc(100vh-220px)] max-w-[calc(100vw-100px)] object-contain"
                style={{ userSelect: 'none' }}
              />
              <svg
                ref={svgRef}
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full"
                onClick={onSvgClick}
                onDoubleClick={onSvgDblClick}
              >
                {/* Mascara oscura afuera del recorte */}
                <defs>
                  <mask id="cropMask">
                    <rect x="0" y="0" width={W} height={H} fill="white" />
                    {mode === 'rect' && rect && (
                      <rect
                        x={rect.x}
                        y={rect.y}
                        width={rect.w}
                        height={rect.h}
                        fill="black"
                      />
                    )}
                    {mode === 'circle' && rect && (
                      <ellipse
                        cx={rect.x + rect.w / 2}
                        cy={rect.y + rect.h / 2}
                        rx={rect.w / 2}
                        ry={rect.h / 2}
                        fill="black"
                      />
                    )}
                    {mode === 'poly' && polyClosed && poly.length >= 3 && (
                      <polygon points={polyPointsAttr} fill="black" />
                    )}
                  </mask>
                </defs>
                <rect
                  x="0"
                  y="0"
                  width={W}
                  height={H}
                  fill="rgba(0,0,0,0.55)"
                  mask="url(#cropMask)"
                  style={{ pointerEvents: 'none' }}
                />

                {/* Modo rectangulo / circulo (mismo bbox con handles) */}
                {(mode === 'rect' || mode === 'circle') && rect && (() => {
                  // Las barras de resize 1D cubren cada lado completo. Para
                  // que las esquinas hagan resize 2D, dejamos un gap de
                  // corner = max(handleSize, ~min(w,h)*0.06) en los extremos
                  // de cada barra; ese gap lo cubren los handles de esquina.
                  const corner = Math.max(handleSize * 1.2, Math.min(rect.w, rect.h) * 0.06);
                  const hitThickness = Math.max(handleSize * 1.4, strokeWidth * 4);
                  const barW = Math.max(0, rect.w - 2 * corner);
                  const barH = Math.max(0, rect.h - 2 * corner);
                  return (
                  <g>
                    {/* Contorno decorativo (no captura): elipse en circulo;
                        rect + guias de tercios en rectangulo. */}
                    {mode === 'circle' ? (
                      <ellipse
                        cx={rect.x + rect.w / 2}
                        cy={rect.y + rect.h / 2}
                        rx={rect.w / 2}
                        ry={rect.h / 2}
                        fill="none"
                        stroke="#7dd3fc"
                        strokeWidth={strokeWidth}
                        style={{ pointerEvents: 'none' }}
                      />
                    ) : (
                      <>
                        <rect
                          x={rect.x}
                          y={rect.y}
                          width={rect.w}
                          height={rect.h}
                          fill="none"
                          stroke="#7dd3fc"
                          strokeWidth={strokeWidth}
                          style={{ pointerEvents: 'none' }}
                        />
                        <g stroke="rgba(125,211,252,0.4)" strokeWidth={strokeWidth * 0.5} style={{ pointerEvents: 'none' }}>
                          <line x1={rect.x + rect.w / 3} y1={rect.y} x2={rect.x + rect.w / 3} y2={rect.y + rect.h} />
                          <line x1={rect.x + (rect.w * 2) / 3} y1={rect.y} x2={rect.x + (rect.w * 2) / 3} y2={rect.y + rect.h} />
                          <line x1={rect.x} y1={rect.y + rect.h / 3} x2={rect.x + rect.w} y2={rect.y + rect.h / 3} />
                          <line x1={rect.x} y1={rect.y + (rect.h * 2) / 3} x2={rect.x + rect.w} y2={rect.y + (rect.h * 2) / 3} />
                        </g>
                      </>
                    )}
                    {/* Move zone (interior, no invade los bordes) */}
                    <rect
                      x={rect.x + corner}
                      y={rect.y + corner}
                      width={Math.max(1, rect.w - 2 * corner)}
                      height={Math.max(1, rect.h - 2 * corner)}
                      fill="transparent"
                      style={{ cursor: 'move', pointerEvents: 'all' }}
                      onPointerDown={startMoveRect}
                    />
                    {/* Resize bars: cubren todo el lado (excepto esquinas) */}
                    {SIDE_KEYS.map((side) => {
                      let x, y, w, h, cursor;
                      if (side === 'n') {
                        x = rect.x + corner;
                        y = rect.y - hitThickness / 2;
                        w = barW;
                        h = hitThickness;
                        cursor = 'ns-resize';
                      } else if (side === 's') {
                        x = rect.x + corner;
                        y = rect.y + rect.h - hitThickness / 2;
                        w = barW;
                        h = hitThickness;
                        cursor = 'ns-resize';
                      } else if (side === 'w') {
                        x = rect.x - hitThickness / 2;
                        y = rect.y + corner;
                        w = hitThickness;
                        h = barH;
                        cursor = 'ew-resize';
                      } else {
                        x = rect.x + rect.w - hitThickness / 2;
                        y = rect.y + corner;
                        w = hitThickness;
                        h = barH;
                        cursor = 'ew-resize';
                      }
                      if (w <= 0 || h <= 0) return null;
                      return (
                        <rect
                          key={side}
                          x={x}
                          y={y}
                          width={w}
                          height={h}
                          fill="transparent"
                          style={{ cursor, pointerEvents: 'all' }}
                          onPointerDown={(e) => startResizeRect(e, side)}
                        />
                      );
                    })}
                    {/* Handles de esquina (visibles, resize 2D) */}
                    {CORNER_KEYS.map((h) => {
                      const hx = h.includes('w') ? rect.x : rect.x + rect.w;
                      const hy = h.includes('n') ? rect.y : rect.y + rect.h;
                      const cursor =
                        h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize';
                      return (
                        <rect
                          key={h}
                          x={hx - handleSize / 2}
                          y={hy - handleSize / 2}
                          width={handleSize}
                          height={handleSize}
                          fill="#7dd3fc"
                          stroke="#0c4a6e"
                          strokeWidth={strokeWidth * 0.6}
                          style={{ cursor, pointerEvents: 'all' }}
                          onPointerDown={(e) => startResizeRect(e, h)}
                        />
                      );
                    })}
                  </g>
                  );
                })()}

                {/* Modo poligonal */}
                {mode === 'poly' && (
                  <g>
                    {/* Lineas */}
                    {poly.length >= 2 && (
                      <polyline
                        points={polyPointsAttr + (polyClosed && poly.length >= 3 ? ` ${poly[0].x},${poly[0].y}` : '')}
                        fill="none"
                        stroke="#7dd3fc"
                        strokeWidth={strokeWidth}
                        style={{ pointerEvents: 'none' }}
                      />
                    )}
                    {/* Hitbox por arista (para insertar puntos) */}
                    {polyClosed && poly.map((p, i) => {
                      const next = poly[(i + 1) % poly.length];
                      return (
                        <line
                          key={`edge-${i}`}
                          x1={p.x}
                          y1={p.y}
                          x2={next.x}
                          y2={next.y}
                          stroke="transparent"
                          strokeWidth={vertexR * 1.4}
                          style={{ cursor: 'copy' }}
                          onClick={(e) => onEdgeClick(e, i)}
                        />
                      );
                    })}
                    {/* Vertices */}
                    {poly.map((p, i) => (
                      <circle
                        key={`v-${i}`}
                        cx={p.x}
                        cy={p.y}
                        r={vertexR}
                        fill={i === 0 && !polyClosed ? '#fbbf24' : '#7dd3fc'}
                        stroke="#0c4a6e"
                        strokeWidth={strokeWidth * 0.6}
                        style={{ cursor: 'grab' }}
                        onPointerDown={(e) => startDragVertex(e, i)}
                        onDoubleClick={(e) => onVertexDblClick(e, i)}
                      />
                    ))}
                  </g>
                )}
              </svg>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-ink-700 bg-ink-900 px-4 py-3 text-sm">
          <div className="text-xs text-ink-400">
            {mode === 'rect' && rect && (
              <>Recorte: {Math.round(rect.w)}×{Math.round(rect.h)}px (de {W}×{H})</>
            )}
            {mode === 'circle' && rect && (
              <>Círculo: {Math.round(rect.w)}×{Math.round(rect.h)}px (de {W}×{H})</>
            )}
            {mode === 'poly' && (
              <>Polígono: {poly.length} {poly.length === 1 ? 'punto' : 'puntos'}{polyClosed ? ' (cerrado)' : ' (abierto)'}</>
            )}
            {error && <span className="ml-3 text-red-300">{error}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-ink-100 hover:border-ink-500 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={busy || (mode === 'poly' && (!polyClosed || poly.length < 3))}
              className="rounded bg-accent-600 px-4 py-1.5 font-medium text-white hover:bg-accent-500 disabled:opacity-50"
            >
              {busy ? 'Procesando…' : 'Aplicar recorte'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
