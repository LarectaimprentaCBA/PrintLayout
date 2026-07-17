// Genera el PDF de una plancha de rótulos escolares: hoja de tamaño fijo con
// 144 celdas (12 grandes + 24 intermedios + 108 chicos). Por celda:
//   fondo (arte, cover) → recuadro del nombre (auto-size, si el arte no lo trae)
//   → nombre (COCON auto-ajustado, líneas por tamaño). Sin corte ni QR (Orden 3).
//
// La lógica de líneas (auto/1/2) y del recuadro dinámico se comparte con el
// preview vía src/rotulos/textLayout.js → lo que ves = lo que imprimís.

import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { cropImageDataUrl } from '../lib/imageCrop.js';
import { MM_TO_PT } from './vendor/fitText.js';
import { resolveSizeLayout, computeNameBox } from './textLayout.js';
import { planchaCeldas } from './planchas.js';

const SIZE_KEYS = ['grande', 'intermedio', 'chico'];

function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const base64 = dataUrl.slice(comma + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function detectMime(dataUrl, fallback = 'image/png') {
  const m = /^data:([^;]+);/.exec(dataUrl);
  return m ? m[1].toLowerCase() : fallback;
}

// '#rrggbb' → rgb() de pdf-lib. Negro si no parsea.
function hexToRgb(hex, fallback = rgb(0, 0, 0)) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Cover-crop centrado (px de la imagen) al aspecto de la celda.
function centerCoverRect(iw, ih, cellW, cellH) {
  const cellAr = cellW / cellH;
  const imgAr = iw / ih;
  let cw;
  let ch;
  if (imgAr > cellAr) { ch = ih; cw = ih * cellAr; } else { cw = iw; ch = iw / cellAr; }
  return { x: (iw - cw) / 2, y: (ih - ch) / 2, w: cw, h: ch };
}

// Rectángulo relleno de esquinas redondeadas, en coords PDF (x,y = esquina
// inferior-izquierda, Y hacia arriba). Compuesto con 2 rects + 4 círculos:
// predecible y sin desborde (pdf-lib no tiene borderRadius).
function drawRoundedRectFill(page, x, y, w, h, r, color) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (rr <= 0.5) { page.drawRectangle({ x, y, width: w, height: h, color }); return; }
  page.drawRectangle({ x, y: y + rr, width: w, height: h - 2 * rr, color });
  page.drawRectangle({ x: x + rr, y, width: w - 2 * rr, height: h, color });
  const corners = [[x + rr, y + rr], [x + w - rr, y + rr], [x + rr, y + h - rr], [x + w - rr, y + h - rr]];
  for (const [cx, cy] of corners) page.drawCircle({ x: cx, y: cy, size: rr, color });
}

function drawTextBlock(page, font, lines, fontSizePt, color, {
  tbXmm, tbYmm, tbWmm, tbHmm, pageHpt, lineHeightFactor,
}) {
  const size = fontSizePt;
  const lineHpt = size * lineHeightFactor;
  const blockHpt = lines.length * lineHpt;
  const tbXpt = tbXmm * MM_TO_PT;
  const tbTopYpt = pageHpt - tbYmm * MM_TO_PT;
  const tbWpt = tbWmm * MM_TO_PT;
  const tbHpt = tbHmm * MM_TO_PT;
  const startTop = Math.max(0, (tbHpt - blockHpt) / 2);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    let w;
    try { w = font.widthOfTextAtSize(line, size); } catch { w = 0; }
    const x = tbXpt + (tbWpt - w) / 2;
    const baselineFromTop = startTop + (i + 0.5) * lineHpt + size * 0.35;
    const y = tbTopYpt - baselineFromTop;
    try { page.drawText(line, { x, y, size, font, color }); } catch (_) { /* glifo faltante */ }
  }
}

// model = { arteIncluyeRecuadro?, sizes:{ grande:{dataUrl,wPx,hPx,textBox,cutMm}, ... } }
export async function buildRotulosPlanchaPdf({
  model,
  fontBytes,
  color,            // color del texto '#rrggbb'
  boxColor = '#ffffff', // color del recuadro dinámico
  text,
  lineModes = {},   // { grande:'auto'|'1'|'2', ... }
  planchaId = 'estandar',
  lineHeightFactor = 1.15,
  minPt = 3,
  maxPt = 120,
}) {
  const { pageWidthMm, pageHeightMm, celdas } = planchaCeldas(planchaId);
  const pageWpt = pageWidthMm * MM_TO_PT;
  const pageHpt = pageHeightMm * MM_TO_PT;
  const textColor = hexToRgb(color);
  const recuadroColor = hexToRgb(boxColor, rgb(1, 1, 1));
  const drawBox = !model.arteIncluyeRecuadro;

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle('Rótulos'); doc.setProducer('PrintLayout'); doc.setCreator('PrintLayout');
  const font = await doc.embedFont(fontBytes, { subset: false });
  const measurePt = (ln, size) => { try { return font.widthOfTextAtSize(ln, size); } catch { return 0; } };

  const page = doc.addPage([pageWpt, pageHpt]);

  // Todas las celdas de un tamaño comparten arte + caja + texto → resolver 1 vez.
  const perSize = {};
  for (const key of SIZE_KEYS) {
    const s = model.sizes?.[key];
    if (!s) continue;
    const cutW = s.cutMm?.w;
    const cutH = s.cutMm?.h;

    let embedded = null;
    if (s.dataUrl && s.wPx && s.hPx && cutW && cutH) {
      const rect = centerCoverRect(s.wPx, s.hPx, cutW, cutH);
      const cropped = await cropImageDataUrl(s.dataUrl, rect, s.wPx, s.hPx);
      const bytes = dataUrlToBytes(cropped);
      const mime = detectMime(cropped, 'image/png');
      embedded = mime.includes('png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    }

    let layout = null;
    let box = null;
    if (s.textBox) {
      layout = resolveSizeLayout({
        text,
        mode: lineModes[key] || 'auto',
        boxWmm: s.textBox.w,
        boxHmm: s.textBox.h,
        minPt,
        maxPt,
        lineHeightFactor,
        measurePt,
      });
      if (drawBox) {
        box = computeNameBox({
          lines: layout.lines,
          fontSizePt: layout.fontSizePt,
          lineHeightFactor,
          zone: s.textBox,
          measurePt,
        });
      }
    }

    perSize[key] = { embedded, textBox: s.textBox, layout, box };
  }

  const hasText = String(text ?? '').trim().length > 0;

  for (const cell of celdas) {
    const ps = perSize[cell.size];
    if (!ps) continue;
    const cellXpt = cell.x * MM_TO_PT;
    const cellTopYpt = pageHpt - cell.y * MM_TO_PT;
    const cellWpt = cell.w * MM_TO_PT;
    const cellHpt = cell.h * MM_TO_PT;
    const cellBottomYpt = cellTopYpt - cellHpt;

    // (a) Fondo (arte cover).
    if (ps.embedded) {
      page.drawImage(ps.embedded, { x: cellXpt, y: cellBottomYpt, width: cellWpt, height: cellHpt });
    }

    if (ps.textBox && ps.layout && hasText) {
      // (b) Recuadro dinámico del nombre.
      if (drawBox && ps.box) {
        const bxPt = (cell.x + ps.box.x) * MM_TO_PT;
        const byTopPt = pageHpt - (cell.y + ps.box.y) * MM_TO_PT;
        const bwPt = ps.box.w * MM_TO_PT;
        const bhPt = ps.box.h * MM_TO_PT;
        drawRoundedRectFill(page, bxPt, byTopPt - bhPt, bwPt, bhPt, ps.box.radius * MM_TO_PT, recuadroColor);
      }
      // (c) Nombre.
      drawTextBlock(page, font, ps.layout.lines, ps.layout.fontSizePt, textColor, {
        tbXmm: cell.x + ps.textBox.x,
        tbYmm: cell.y + ps.textBox.y,
        tbWmm: ps.textBox.w,
        tbHmm: ps.textBox.h,
        pageHpt,
        lineHeightFactor,
      });
    }
  }

  return doc.save();
}
