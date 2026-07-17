// Lógica de líneas por tamaño + recuadro dinámico del nombre. Compartida entre
// el preview (measure de canvas) y el PDF (measure de pdf-lib) para que "lo que
// ves = lo que imprimís".

import { fitTextIntoBox, MM_TO_PT } from './vendor/fitText.js';

const norm = (s) => String(s ?? '').replace(/\r/g, '');

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

// Recuadro dinámico del nombre: bounding box del texto + padding, centrado en la
// zona (textBox). Nombre corto → recuadro chico; largo → hasta el máximo de la
// zona. Devuelve {x,y,w,h,radius} en mm (mismo sistema que el textBox).
export function computeNameBox({ lines, fontSizePt, lineHeightFactor = 1.15, zone, measurePt }) {
  let maxW = 0;
  for (const ln of lines) maxW = Math.max(maxW, measurePt ? measurePt(ln, fontSizePt) : 0);
  const textWmm = maxW / MM_TO_PT;
  const textHmm = (lines.length * fontSizePt * lineHeightFactor) / MM_TO_PT;
  const fsMm = fontSizePt / MM_TO_PT;
  const padXmm = fsMm * 0.3;
  const padYmm = fsMm * 0.12;
  const w = Math.min(zone.w, textWmm + 2 * padXmm);
  const h = Math.min(zone.h, textHmm + 2 * padYmm);
  const cx = zone.x + zone.w / 2;
  const cy = zone.y + zone.h / 2;
  const radius = Math.min(w, h) * 0.2;
  return { x: cx - w / 2, y: cy - h / 2, w, h, radius };
}
