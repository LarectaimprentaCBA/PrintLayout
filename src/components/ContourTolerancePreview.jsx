import { useEffect, useRef, useState } from 'react';
import { applySolidBgRemoval } from '../lib/contour/solidBgRemoval.js';

// Preview en vivo de la tolerancia del contorno, sobre la celda seleccionada.
// Pinta en ROJO translúcido lo que QUEDA (la silueta del sticker) al sacar el
// fondo a la tolerancia actual. Baja resolución (instantáneo, NO traza, NO usa
// Potrace) → se actualiza al toque al mover el slider, sin trabar la pantalla.
// El contorno real (la línea de corte) lo calcula aparte el flujo normal.
const PREVIEW_DIM = 260;

export default function ContourTolerancePreview({ imageUrl, tolerance, includeHoles, style }) {
  const srcRef = useRef(null); // { data: ImageData, w, h } imagen base reducida
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);
  const rafRef = useRef(0);

  // Cargar la imagen reducida una vez por imageUrl.
  useEffect(() => {
    setReady(false);
    srcRef.current = null;
    if (!imageUrl) return undefined;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const sc = Math.min(1, PREVIEW_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * sc));
      const h = Math.max(1, Math.round(img.naturalHeight * sc));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cx = c.getContext('2d');
      cx.drawImage(img, 0, 0, w, h);
      srcRef.current = { data: cx.getImageData(0, 0, w, h), w, h };
      setReady(true);
    };
    img.onerror = () => {};
    img.src = imageUrl;
    return () => { cancelled = true; };
  }, [imageUrl]);

  // Repintar (máx 1 por frame) al cambiar tolerancia/huecos.
  useEffect(() => {
    if (!ready) return undefined;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const src = srcRef.current;
      const canvas = canvasRef.current;
      if (!src || !canvas) return;
      const { w, h, data } = src;
      canvas.width = w; canvas.height = h;
      const cx = canvas.getContext('2d');
      const buf = new Uint8ClampedArray(data.data);
      // detectHoles SIEMPRE on para reflejar la geometría real que se traza
      // (el aro queda como aro, las letras visibles), igual que computeStickerContour.
      applySolidBgRemoval(buf, w, h, { tolerance, detectHoles: true, defringe: true });
      const out = cx.createImageData(w, h);
      const od = out.data;
      for (let i = 0; i < buf.length; i += 4) {
        if (buf[i + 3] > 8) {
          // Lo que QUEDA: rojo translúcido encima del diseño.
          od[i] = 239; od[i + 1] = 68; od[i + 2] = 68; od[i + 3] = 110;
        } else {
          od[i + 3] = 0; // lo que se saca: transparente
        }
      }
      cx.putImageData(out, 0, 0);
    });
    return () => cancelAnimationFrame(rafRef.current);
  }, [ready, tolerance, includeHoles]);

  // object-contain + el mismo rect interior que la imagen → calza con el diseño.
  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute z-10 object-contain"
      style={style}
    />
  );
}
