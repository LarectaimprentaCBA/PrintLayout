// Generación de la carta de color (para imprimir) — port de Carta.cs Generar().
// Dibuja 343 parches + 4 marcas de registro + marca de orientación + código legible
// por máquina + rótulo humano, en un canvas a 240 dpi (misma resolución que imprime
// PrintLayout). Devuelve un dataURL PNG listo para PrintHelper.

import {
  PageWmm, PageHmm, Dpi, Count, patchColor, patchCenterMm,
  Patch, Markers, MarkerOuter, MarkerInner, OrientX, OrientY, OrientSize, px,
} from './layout.js';
import { encodeBits, drawCode } from './code.js';

function rectMm(ctx, cxMm, cyMm, sideMm, color) {
  const x0 = px(cxMm - sideMm / 2), y0 = px(cyMm - sideMm / 2);
  const x1 = px(cxMm + sideMm / 2), y1 = px(cyMm + sideMm / 2);
  ctx.fillStyle = color;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

// Dibuja la carta completa en un contexto 2D ya dimensionado a px(210)×px(297).
// opts: { etiqueta, pie, sessionId, role, withCode=true }
export function drawChart(ctx, opts = {}) {
  const { etiqueta = '', pie = '', sessionId = 0, role = 0, withCode = true } = opts;
  const w = px(PageWmm), h = px(PageHmm);

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;

  // Parches
  for (let i = 0; i < Count; i++) {
    const [r, g, b] = patchColor(i);
    const [cx, cy] = patchCenterMm(i);
    const x0 = px(cx - Patch / 2), y0 = px(cy - Patch / 2);
    const x1 = px(cx + Patch / 2), y1 = px(cy + Patch / 2);
    ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  // Marcas de registro (anillos) + marca de orientación
  for (let k = 0; k < 4; k++) {
    rectMm(ctx, Markers[k][0], Markers[k][1], MarkerOuter, '#000');
    rectMm(ctx, Markers[k][0], Markers[k][1], MarkerInner, '#fff');
  }
  rectMm(ctx, OrientX, OrientY, OrientSize, '#000');

  // Código legible por máquina (id de sesión + rol + control)
  if (withCode) drawCode(ctx, encodeBits(sessionId & 0xffff, role), px);

  // Rótulo humano
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 34px Arial, sans-serif';
  ctx.fillText(etiqueta || '', px(34), px(8.5));
  ctx.font = '24px Arial, sans-serif';
  ctx.fillText(pie || '', px(34), px(18.5));
}

const PIE_DEFAULT = 'Escanear la hoja entera: color, 300 dpi, JPEG maxima calidad, sin ajustes automaticos. No escribir sobre los parches.';

// Renderiza la carta a un dataURL PNG (solo en el renderer: usa document/canvas).
// opts: { etiqueta, pie, sessionId, role, withCode }
export function renderChartToDataURL(opts = {}) {
  if (typeof document === 'undefined') throw new Error('renderChartToDataURL solo corre en el renderer');
  const canvas = document.createElement('canvas');
  canvas.width = px(PageWmm);
  canvas.height = px(PageHmm);
  const ctx = canvas.getContext('2d');
  drawChart(ctx, { pie: PIE_DEFAULT, ...opts });
  return canvas.toDataURL('image/png');
}

// Arma las dos cartas de una sesión de calibración (referencia + a corregir).
// labels: { referencia, correccion } textos de rótulo. role: 0 ref, 1 corregir.
export function renderCalibrationCharts(sessionId, labels = {}) {
  return {
    referencia: renderChartToDataURL({
      etiqueta: labels.referencia || 'CARTA DE COLOR - REFERENCIA',
      sessionId, role: 0, withCode: true,
    }),
    correccion: renderChartToDataURL({
      etiqueta: labels.correccion || 'CARTA DE COLOR - A CORREGIR',
      sessionId, role: 1, withCode: true,
    }),
  };
}

export { PIE_DEFAULT };
