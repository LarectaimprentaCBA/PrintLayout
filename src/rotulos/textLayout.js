// Lógica de líneas por tamaño + recuadro dinámico del nombre. Compartida entre
// el preview (measure de canvas) y el PDF (measure de pdf-lib) para que "lo que
// ves = lo que imprimís".

import { fitTextIntoBox, MM_TO_PT } from './vendor/fitText.js';
import { clampCenterRotated } from './boxEditing.js';

const norm = (s) => String(s ?? '').replace(/\r/g, '');
const OVERLAY_MIN_PT = 3;
const CUT_MARGIN_MM = 0.5; // margen mínimo entre la letra y el borde del sticker

// Divide el texto en `count` líneas.
//   count 1 → todo junto (los Enter pasan a ser espacios).
//   count 2 → si hay Enter(s), corta en el límite de segmento que mejor balancea
//             (respeta el Enter); si no, balancea por palabras (minimiza el ancho
//             de la línea más larga).
export function computeLines(text, count, measurePt) {
  const segments = norm(text).split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
  const allWords = segments.join(' ').split(/\s+/).filter(Boolean);
  if (count <= 1 || allWords.length <= 1) {
    return [allWords.join(' ')];
  }
  // count === 2
  const measure = (s) => (measurePt ? measurePt(s, 10) : s.length);
  let best = null;
  let bestScore = Infinity;
  const consider = (l1, l2) => {
    const score = Math.max(measure(l1), measure(l2));
    if (score < bestScore) { bestScore = score; best = [l1, l2]; }
  };
  if (segments.length >= 2) {
    // Cortar sólo en límites de segmento (respeta el Enter del usuario).
    for (let k = 1; k < segments.length; k++) {
      consider(segments.slice(0, k).join(' '), segments.slice(k).join(' '));
    }
  } else {
    // Un solo segmento: cortar entre palabras.
    for (let j = 1; j < allWords.length; j++) {
      consider(allWords.slice(0, j).join(' '), allWords.slice(j).join(' '));
    }
  }
  return best || [allWords.join(' ')];
}

// Resuelve las líneas + tamaño para UN tamaño de rótulo según el modo.
//   mode 'auto' → prueba 1 y 2 líneas, se queda con el que da MAYOR fontSize.
//   mode '1' | '2' → esa cantidad fija.
// Devuelve { count, lines, fontSizePt }.
export function resolveSizeLayout({
  text, mode = 'auto', boxWmm, boxHmm,
  minPt = 3, maxPt = 120, lineHeightFactor = 1.15, measurePt,
}) {
  const fitFor = (lines) => fitTextIntoBox({
    lines, boxWmm, boxHmm, minPt, maxPt, lineHeightFactor, measurePt,
  });

  if (mode === '1' || mode === '2') {
    const count = mode === '1' ? 1 : 2;
    const lines = computeLines(text, count, measurePt);
    return { count, lines, fontSizePt: fitFor(lines).fontSizePt };
  }

  // auto: candidatos 1 y 2 líneas.
  const cand = [1, 2].map((count) => {
    const lines = computeLines(text, count, measurePt);
    return { count, lines, fontSizePt: fitFor(lines).fontSizePt };
  });
  // Mayor fontSize primero; empate → menos líneas.
  cand.sort((a, b) => (b.fontSizePt - a.fontSizePt) || (a.count - b.count));
  return cand[0];
}

// El recuadro del nombre ocupa TODA la zona dibujada. Devuelve {x,y,w,h,radius}.
export function zoneAsBox(zone) {
  const w = zone.w;
  const h = zone.h;
  return { x: zone.x, y: zone.y, w, h, radius: Math.min(w, h) * 0.2 };
}

// Recuadro que "abraza" el texto ya resuelto, centrado dentro de la zona. La zona
// dibujada por el usuario es el MÁXIMO; el recuadro se achica al ancho/alto real
// del nombre + el aire, sin pasarse de la zona. Devuelve {x,y,w,h,radius,rotation}.
// (El overlay dibuja el recuadro centrado en la zona, así que x/y son informativos;
// lo que importa para el dibujo es w/h/radius.)
export function hugBoxToText(zone, layout, padMm, measurePt, lineHeightFactor = 1.15, opts = {}) {
  if (!zone) return null;
  if (!layout || !measurePt || !Array.isArray(layout.lines) || layout.lines.length === 0) {
    return zoneAsBox(zone);
  }
  const p = Math.max(0, padMm || 0);
  // Por defecto el recuadro no se pasa de la zona; si se pide (letra agrandada)
  // el tope es el corte (opts.maxW/maxH).
  const capW = Number.isFinite(opts.maxW) ? opts.maxW : zone.w;
  const capH = Number.isFinite(opts.maxH) ? opts.maxH : zone.h;
  let maxWpt = 0;
  for (const ln of layout.lines) {
    const wpt = measurePt(ln || '', layout.fontSizePt);
    if (wpt > maxWpt) maxWpt = wpt;
  }
  const textWmm = maxWpt / MM_TO_PT;
  const textHmm = (layout.lines.length * layout.fontSizePt * lineHeightFactor) / MM_TO_PT;
  const w = Math.max(1, Math.min(capW, textWmm + 2 * p));
  const h = Math.max(1, Math.min(capH, textHmm + 2 * p));
  const cx = zone.x + zone.w / 2;
  const cy = zone.y + zone.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h, radius: Math.min(w, h) * 0.2, rotation: zone.rotation || 0 };
}

// Combina "abrazar el nombre" + escala de letra manual. `scale` 1 = Auto (la
// letra llena la zona dibujada). scale > 1 agranda la letra MÁS ALLÁ de la zona,
// topada para que no se pase del corte; scale < 1 la achica. Devuelve:
//   · drawLayout: el layout con la fuente escalada/topada,
//   · box: el recuadro que abraza la letra (tope = corte cuando se agranda),
//   · drawZone: la zona con el centro reubicado para que todo quede en el corte.
export function resolveScaledOverlay({
  zone, layout, scale = 1, padMm = 0, cutW, cutH, measurePt, lineHeightFactor = 1.15, maxPt = 120,
}) {
  if (!zone || !layout) {
    return { drawLayout: layout, box: zone ? zoneAsBox(zone) : null, drawZone: zone };
  }
  const s = scale > 0 ? scale : 1;
  let font = layout.fontSizePt * s;
  // Tope físico: la letra (con su aire) no puede pasar el borde del sticker.
  if (measurePt && Array.isArray(layout.lines) && layout.lines.length && Number.isFinite(cutW) && Number.isFinite(cutH)) {
    const maxW = Math.max(1, cutW - 2 * padMm - 2 * CUT_MARGIN_MM);
    const maxH = Math.max(1, cutH - 2 * padMm - 2 * CUT_MARGIN_MM);
    const cap = fitTextIntoBox({ lines: layout.lines, boxWmm: maxW, boxHmm: maxH, minPt: OVERLAY_MIN_PT, maxPt, lineHeightFactor, measurePt });
    font = Math.min(font, cap.fontSizePt);
  }
  font = Math.max(OVERLAY_MIN_PT, font);
  const drawLayout = { ...layout, fontSizePt: font };
  // Escala REALMENTE aplicada (tras el tope del sticker): el control −/+ se apoya
  // en esto para no acumular en el vacío una vez que la letra llegó al borde.
  const appliedScale = layout.fontSizePt > 0 ? font / layout.fontSizePt : 1;
  const useCut = s > 1 && Number.isFinite(cutW) && Number.isFinite(cutH);
  const box = hugBoxToText(zone, drawLayout, padMm, measurePt, lineHeightFactor, useCut ? { maxW: cutW, maxH: cutH } : {});
  let drawZone = zone;
  if (box && useCut) {
    // El recuadro puede ser más grande que la zona: recentramos para no salirnos.
    const cx = zone.x + zone.w / 2;
    const cy = zone.y + zone.h / 2;
    const { cx: ncx, cy: ncy } = clampCenterRotated(cx, cy, box.w, box.h, zone.rotation, cutW, cutH);
    drawZone = { ...zone, x: ncx - zone.w / 2, y: ncy - zone.h / 2 };
  }
  return { drawLayout, box, drawZone, appliedScale };
}

// Aire efectivo dentro del recuadro = el aire pedido + el grosor del contorno,
// pero ACOTADO a una fracción del lado más chico de la zona. Así en el rótulo
// chico (zona muy baja) el margen no se come casi todo el alto y la letra crece.
export function effectivePad(basePadMm, outlineMm, zone) {
  const want = Math.max(0, basePadMm || 0) + Math.max(0, outlineMm || 0);
  const cap = 0.18 * Math.min(zone.w, zone.h);
  return Math.min(want, cap);
}

// Aire base del recuadro por tamaño. `boxPadMm` puede ser un objeto
// {grande,intermedio,chico} (nuevo) o un número (specs viejas / global). Default 0.8.
export const DEFAULT_BOX_PAD_MM = 0.8;
export function padForSize(boxPadMm, size) {
  if (boxPadMm && typeof boxPadMm === 'object') {
    return Number.isFinite(boxPadMm[size]) ? boxPadMm[size] : DEFAULT_BOX_PAD_MM;
  }
  return Number.isFinite(boxPadMm) ? boxPadMm : DEFAULT_BOX_PAD_MM;
}
