// Genera el PDF de una plancha de rótulos escolares: hoja de tamaño fijo con
// 144 celdas (12 grandes + 24 intermedios + 108 chicos), cada una con su arte
// (cover) + el nombre auto-ajustado (fitTextIntoBox) en la caja de ese tamaño,
// con la fuente y color elegidos. NO dibuja corte ni QR (van en la Orden 3).
//
// Reusa la lógica de src/lib/exportPdf.js (MM_TO_PT, dataURL→bytes, hex→rgb,
// cover-crop) pero con su propio loop, porque el modelo por-celda (arte por
// tamaño + texto) no encaja en el pipeline de assignments/imageMap.

import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { cropImageDataUrl } from '../lib/imageCrop.js';
import { fitTextIntoBox, MM_TO_PT } from './vendor/fitText.js';
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
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return rgb(0, 0, 0);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Rectángulo de cover-crop centrado (sin face detection): recorta la imagen al
// aspecto de la celda, centrado. Devuelve rect en px de la imagen.
function centerCoverRect(iw, ih, cellW, cellH) {
  const cellAr = cellW / cellH;
  const imgAr = iw / ih;
  let cw;
  let ch;
  if (imgAr > cellAr) { ch = ih; cw = ih * cellAr; } else { cw = iw; ch = iw / cellAr; }
  return { x: (iw - cw) / 2, y: (ih - ch) / 2, w: cw, h: ch };
}

// Dibuja el bloque de texto (lines) centrado vertical en la caja y cada línea
// centrada horizontal. Mismo modelo que el preview (bloque centrado, líneas
// apiladas con lineHeightFactor).
function drawTextBlock(page, font, fit, color, {
  tbXmm, tbYmm, tbWmm, tbHmm, pageHpt, lineHeightFactor,
}) {
  const size = fit.fontSizePt;
  const { lines } = fit;
  const lineHpt = size * lineHeightFactor;
  const blockHpt = lines.length * lineHpt;
  const tbXpt = tbXmm * MM_TO_PT;
  const tbTopYpt = pageHpt - tbYmm * MM_TO_PT; // borde superior de la caja (Y hacia arriba)
  const tbWpt = tbWmm * MM_TO_PT;
  const tbHpt = tbHmm * MM_TO_PT;
  const startTop = Math.max(0, (tbHpt - blockHpt) / 2); // padding vertical desde el top

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    let w;
    try { w = font.widthOfTextAtSize(line, size); } catch { w = 0; }
    const x = tbXpt + (tbWpt - w) / 2;
    const slotCenterFromTop = startTop + (i + 0.5) * lineHpt;
    const baselineFromTop = slotCenterFromTop + size * 0.35; // aprox. centro óptico
    const y = tbTopYpt - baselineFromTop;
    try {
      page.drawText(line, { x, y, size, font, color });
    } catch (_) {
      // Glifo faltante en la fuente: se omite esa línea antes que romper todo.
    }
  }
}

// model = { sizes: { grande:{dataUrl,wPx,hPx,textBox:{x,y,w,h},cutMm:{w,h}}, ... } }
// fontBytes = Uint8Array de la fuente; color = '#rrggbb'; text = string (con \n).
export async function buildRotulosPlanchaPdf({
  model,
  fontBytes,
  color,
  text,
  planchaId = 'estandar',
  lineHeightFactor = 1.15,
  minPt = 3,
  maxPt = 120,
}) {
  const { pageWidthMm, pageHeightMm, celdas } = planchaCeldas(planchaId);
  const pageWpt = pageWidthMm * MM_TO_PT;
  const pageHpt = pageHeightMm * MM_TO_PT;
  const lines = String(text ?? '').split('\n');
  const textColor = hexToRgb(color);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle('Rótulos'); doc.setProducer('PrintLayout'); doc.setCreator('PrintLayout');
  // subset:false a propósito (paridad con TarjetasApp): embebe la fuente completa.
  const font = await doc.embedFont(fontBytes, { subset: false });

  const page = doc.addPage([pageWpt, pageHpt]);

  // Todas las celdas de un tamaño comparten w×h y textBox → embebemos el arte
  // (cover) y calculamos el fit del texto UNA sola vez por tamaño.
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

    let fit = null;
    if (s.textBox) {
      fit = fitTextIntoBox({
        lines,
        boxWmm: s.textBox.w,
        boxHmm: s.textBox.h,
        minPt,
        maxPt,
        lineHeightFactor,
        measurePt: (ln, size) => {
          try { return font.widthOfTextAtSize(ln, size); } catch { return 0; }
        },
      });
    }

    perSize[key] = { embedded, textBox: s.textBox, fit };
  }

  for (const cell of celdas) {
    const ps = perSize[cell.size];
    if (!ps) continue;
    const cellXpt = cell.x * MM_TO_PT;
    const cellTopYpt = pageHpt - cell.y * MM_TO_PT; // borde superior de la celda
    const cellWpt = cell.w * MM_TO_PT;
    const cellHpt = cell.h * MM_TO_PT;
    const cellBottomYpt = cellTopYpt - cellHpt;

    // (a) Arte (cover).
    if (ps.embedded) {
      page.drawImage(ps.embedded, {
        x: cellXpt, y: cellBottomYpt, width: cellWpt, height: cellHpt,
      });
    }

    // (b) Nombre auto-ajustado en la caja.
    if (ps.textBox && ps.fit) {
      drawTextBlock(page, font, ps.fit, textColor, {
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
