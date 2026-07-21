// Dibujo del "overlay" de un rótulo (recuadro + nombre con contorno, rotado)
// sobre un canvas. Lo usan IGUAL el preview (baja resolución, en pantalla) y la
// generación del PDF (alta resolución -> PNG embebido). Así el contorno del PDF
// queda tan limpio como el del preview (strokeText del canvas, sin huecos ni
// bordes sucios) y "lo que ves = lo que imprimís".

import { MM_TO_PT } from './vendor/fitText.js';

// Measure de canvas: ancho EN PUNTOS (= size × avance del glifo).
export function makeCanvasMeasure(family) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  return (line, sizePt) => { ctx.font = `${sizePt}px "${family}"`; return ctx.measureText(line || '').width; };
}

// Dibuja el overlay en el marco del rótulo (cutW×cutH mm) sobre `ctx`.
// scale = px por mm. No limpia ni ajusta dpr (lo hace el caller).
export function drawRotuloOverlay(ctx, {
  scale, family, textColor, boxColor, drawBox, box, zone, layout, outline, lineHeightFactor = 1.15,
}) {
  if (!zone || !layout || !family) return;
  const rotRad = ((zone.rotation || 0) * Math.PI) / 180;
  ctx.save();
  ctx.translate((zone.x + zone.w / 2) * scale, (zone.y + zone.h / 2) * scale);
  ctx.rotate(rotRad); // canvas Y-abajo: positivo = horario (igual que el usuario)

  if (drawBox && box) {
    const bw = box.w * scale;
    const bh = box.h * scale;
    const r = Math.max(0, Math.min(box.radius * scale, Math.min(bw, bh) / 2));
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-bw / 2, -bh / 2, bw, bh, r); else ctx.rect(-bw / 2, -bh / 2, bw, bh);
    ctx.fillStyle = boxColor;
    ctx.fill();
  }

  const fontSizePx = (layout.fontSizePt / MM_TO_PT) * scale;
  ctx.font = `${fontSizePx}px "${family}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lineHpx = fontSizePx * lineHeightFactor;
  const startY = -(layout.lines.length * lineHpx) / 2 + lineHpx / 2;
  const useOutline = outline && outline.enabled && outline.widthMm > 0;
  if (useOutline) {
    ctx.lineJoin = outline.join || 'round';
    ctx.miterLimit = 4;
    ctx.lineWidth = outline.widthMm * scale * 2; // strokeText detrás del fill -> visible ~widthMm
    ctx.strokeStyle = outline.color;
  }
  ctx.fillStyle = textColor;
  layout.lines.forEach((ln, i) => {
    const y = startY + i * lineHpx;
    if (useOutline) ctx.strokeText(ln || '', 0, y);
    ctx.fillText(ln || '', 0, y);
  });
  ctx.restore();
}

// Renderiza el overlay a un PNG dataURL (fondo transparente) a la resolución
// dada, para embeberlo en el PDF. cutW/cutH en mm.
export function renderOverlayPng({ cutWmm, cutHmm, dpi = 600, ...opts }) {
  const scale = dpi / 25.4; // px por mm
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cutWmm * scale));
  canvas.height = Math.max(1, Math.round(cutHmm * scale));
  const ctx = canvas.getContext('2d');
  drawRotuloOverlay(ctx, { scale, ...opts });
  return canvas.toDataURL('image/png');
}
