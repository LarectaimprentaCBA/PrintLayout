// Genera el PDF de una plancha de rótulos escolares (325×500, 144 celdas). Por
// celda: fondo (arte, cover) + overlay (recuadro + nombre con contorno, rotado).
// El overlay se rasteriza con el MISMO motor de canvas que el preview, a alta
// resolución (dpi), y se estampa como PNG -> el contorno sale limpio y el PDF
// queda idéntico al preview. Sin corte ni QR (Orden 3).

import { PDFDocument } from 'pdf-lib';
import { cropImageDataUrl } from '../lib/imageCrop.js';
import { MM_TO_PT } from './vendor/fitText.js';
import { resolveSizeLayout, resolveScaledOverlay, effectivePad, padForSize } from './textLayout.js';
import { makeCanvasMeasure, renderOverlayPng } from './drawOverlay.js';
import { planchaCeldas, MARK_MARGIN_MM } from './planchas.js';
import { drawCornerMarks, drawQr } from '../lib/exportPdf.js';

const SIZE_KEYS = ['grande', 'intermedio', 'chico'];

// Sangrado del arte: el arte se imprime 1 mm MÁS GRANDE que el corte por cada
// lado (grande 62×42, interm 42×22, chico 42×9) y el corte queda adentro. Así
// la tolerancia normal de registro del plotter cae siempre sobre color y no se
// ve borde blanco / corte corrido (es lo que hace el flujo histórico de Corel).
const BLEED_MM = 1;

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

export function centerCoverRect(iw, ih, cellW, cellH) {
  const cellAr = cellW / cellH;
  const imgAr = iw / ih;
  let cw;
  let ch;
  if (imgAr > cellAr) { ch = ih; cw = ih * cellAr; } else { cw = iw; ch = iw / cellAr; }
  return { x: (iw - cw) / 2, y: (ih - ch) / 2, w: cw, h: ch };
}

// model = { arteIncluyeRecuadro?, sizes:{ grande:{dataUrl,wPx,hPx,textBox,cutMm}, ... } }
// family = familia de la fuente ya cargada como FontFace en el documento (para el canvas).
export async function buildRotulosPlanchaPdf({
  model,
  family,
  color,
  boxColor = '#ffffff',
  noBox = false,
  text,
  lineModes = {},
  textScales = {},
  outline = null,
  boxPadMm = 0.8, // número (global) u objeto {grande,intermedio,chico}
  planchaId = 'plancha1',
  lineHeightFactor = 1.15,
  minPt = 3,
  maxPt = 120,
  dpi = 600,
  markMarginMm = MARK_MARGIN_MM,
  qr = null, // { text, sizeMm, bottomMm, centered } — QR fijo de la hoja
}) {
  const { pageWidthMm, pageHeightMm, celdas } = planchaCeldas(planchaId);
  const pageWpt = pageWidthMm * MM_TO_PT;
  const pageHpt = pageHeightMm * MM_TO_PT;
  const drawBox = !model.arteIncluyeRecuadro && !noBox;
  const measurePt = makeCanvasMeasure(family);
  const hasText = String(text ?? '').trim().length > 0;

  const doc = await PDFDocument.create();
  doc.setTitle('Rótulos'); doc.setProducer('PrintLayout'); doc.setCreator('PrintLayout');
  const page = doc.addPage([pageWpt, pageHpt]);

  // Todas las celdas de un tamaño comparten arte + overlay → se embeben 1 vez.
  const perSize = {};
  for (const key of SIZE_KEYS) {
    const s = model.sizes?.[key];
    if (!s) continue;
    const cutW = s.cutMm?.w;
    const cutH = s.cutMm?.h;

    let arteImg = null;
    if (s.dataUrl && s.wPx && s.hPx && cutW && cutH) {
      // Recortar el arte a la proporción CON sangrado (corte + 1mm por lado).
      const rect = centerCoverRect(s.wPx, s.hPx, cutW + 2 * BLEED_MM, cutH + 2 * BLEED_MM);
      const cropped = await cropImageDataUrl(s.dataUrl, rect, s.wPx, s.hPx);
      const bytes = dataUrlToBytes(cropped);
      const mime = detectMime(cropped, 'image/png');
      arteImg = mime.includes('png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    }

    let overlayImg = null;
    if (s.textBox && hasText && family && cutW && cutH) {
      const outlineMm = (outline && outline.enabled && outline.widthMm > 0) ? outline.widthMm : 0;
      // El recuadro = la zona dibujada; el nombre se ajusta adentro con el aire
      // (acotado en zonas chicas) + el grosor del contorno.
      const pad = effectivePad(drawBox ? padForSize(boxPadMm, key) : 0, outlineMm, s.textBox);
      const layout = resolveSizeLayout({
        text, mode: lineModes[key] || 'auto',
        boxWmm: Math.max(1, s.textBox.w - 2 * pad), boxHmm: Math.max(1, s.textBox.h - 2 * pad),
        minPt, maxPt, lineHeightFactor, measurePt,
      });
      const { drawLayout, box, drawZone } = resolveScaledOverlay({
        zone: s.textBox, layout, scale: textScales[key] || 1, padMm: pad,
        cutW, cutH, measurePt, lineHeightFactor, maxPt,
      });
      const png = renderOverlayPng({
        cutWmm: cutW, cutHmm: cutH, dpi, family,
        textColor: color, boxColor, drawBox, box: drawBox ? box : null,
        zone: drawZone, layout: drawLayout, outline, lineHeightFactor,
      });
      overlayImg = await doc.embedPng(dataUrlToBytes(png));
    }

    perSize[key] = { arteImg, overlayImg };
  }

  for (const cell of celdas) {
    const ps = perSize[cell.size];
    if (!ps) continue;
    const x = cell.x * MM_TO_PT;
    const yBottom = pageHpt - cell.y * MM_TO_PT - cell.h * MM_TO_PT;
    const w = cell.w * MM_TO_PT;
    const h = cell.h * MM_TO_PT;
    // El ARTE va con sangrado: 1 mm más grande por cada lado, centrado en el
    // corte. El corte (cortes) y el NOMBRE quedan al tamaño del corte.
    const bPt = BLEED_MM * MM_TO_PT;
    if (ps.arteImg) page.drawImage(ps.arteImg, { x: x - bPt, y: yBottom - bPt, width: w + 2 * bPt, height: h + 2 * bPt });
    if (ps.overlayImg) page.drawImage(ps.overlayImg, { x, y: yBottom, width: w, height: h });
  }

  // Marcas L de registro (mismo markMarginMm que el .plt) + QR fijo de la hoja.
  // El QR/borde inferior es la referencia de orientación al cargar en el plotter.
  drawCornerMarks(page, {
    offsetXpt: 0, offsetYpt: 0, templateWpt: pageWpt, templateHpt: pageHpt, markMarginMm,
  });
  if (qr && qr.text) {
    drawQr(page, {
      text: qr.text, pageWmm: pageWidthMm, sizeMm: qr.sizeMm, bottomMm: qr.bottomMm, centered: qr.centered,
    });
  }

  return doc.save();
}
