// Dibuja las hojas de fotos en un canvas a 240 dpi (real en mm). Cada foto se
// gira 90° si así llena mejor su celda (como Windows), y va recortada con foco
// en caras (Enmarcar) o entera dentro de la celda (ajustada). Fondo blanco (los
// PNG con transparencia salen sobre blanco).
import { coverCropRect } from '../lib/faceDetection.js';

const mmToPx = (mm, dpi) => (mm / 25.4) * dpi;

function drawPhotoCell(ctx, photo, xpx, ypx, wpx, hpx, framed) {
  const iw = photo.width, ih = photo.height;
  const cellLandscape = wpx > hpx;
  const imgLandscape = iw > ih;
  const rot = imgLandscape !== cellLandscape ? 90 : 0;
  ctx.save();
  ctx.translate(xpx + wpx / 2, ypx + hpx / 2);
  if (rot) ctx.rotate(Math.PI / 2);
  const boxW = rot ? hpx : wpx;
  const boxH = rot ? wpx : hpx;
  if (framed) {
    const crop = coverCropRect({ width: iw, height: ih, faces: photo.faces }, boxW, boxH)
      || { x: 0, y: 0, w: iw, h: ih };
    ctx.drawImage(photo.bitmap, crop.x, crop.y, crop.w, crop.h, -boxW / 2, -boxH / 2, boxW, boxH);
  } else {
    const scale = Math.min(boxW / iw, boxH / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(photo.bitmap, -dw / 2, -dh / 2, dw, dh);
  }
  ctx.restore();
}

// Reparte las fotos (ya expandidas por copias) en hojas según perSheet.
export function paginate(photos, perSheet) {
  const sheets = [];
  for (let i = 0; i < photos.length; i += perSheet) sheets.push(photos.slice(i, i + perSheet));
  return sheets;
}

/**
 * Plan de hojas SIN repetir trabajo.
 *
 * Con copias, la mayoría de las hojas son idénticas: 2 fotos × 50 copias con 2
 * fotos por hoja son 50 hojas, pero HOJAS DISTINTAS hay dos. Antes se armaban,
 * comprimían, mandaban y corregían de color las 50, una por una: de ahí que
 * tardara una eternidad. Ahora se arma cada hoja distinta UNA vez y el orden
 * dice cuál va en cada lugar.
 *
 * @param {number} nFotos    cuántas fotos hay
 * @param {number} copias    copias de cada foto
 * @param {number} porHoja   cuántas entran en una hoja
 * @returns {{distintas:number[][], orden:number[]}} distintas = hojas (índices
 *   de foto); orden = qué hoja distinta va en cada posición.
 */
export function planSheets(nFotos, copias, porHoja) {
  const n = Math.max(1, Math.floor(Number(copias) || 1));
  const k = Math.max(1, Math.floor(Number(porHoja) || 1));
  const plano = [];
  for (let i = 0; i < Math.max(0, nFotos | 0); i++) for (let c = 0; c < n; c++) plano.push(i);
  const distintas = [];
  const orden = [];
  const vistas = new Map();
  for (let i = 0; i < plano.length; i += k) {
    const hoja = plano.slice(i, i + k);
    const clave = hoja.join(',');
    let idx = vistas.get(clave);
    if (idx === undefined) { idx = distintas.length; vistas.set(clave, idx); distintas.push(hoja); }
    orden.push(idx);
  }
  return { distintas, orden };
}

/**
 * Dibuja UNA hoja en el canvas dado. layout.positions en mm relativas al área
 * imprimible (printWmm × printHmm).
 *
 * `guias` es SOLO para la vista previa: con {paperWmm, paperHmm, marginLmm,
 * marginTmm} el canvas pasa a ser la HOJA ENTERA (no el área imprimible) y se
 * dibujan el borde de lo que la impresora alcanza a marcar y el recuadro de
 * cada lugar, incluso los que quedan vacíos. Sin `guias` sale exactamente lo
 * que se imprime: solo las fotos sobre blanco.
 */
export function renderSheetToCanvas(canvas, sheetPhotos, layout, printWmm, printHmm, dpi, framed, guias = null) {
  const hojaW = guias ? guias.paperWmm : printWmm;
  const hojaH = guias ? guias.paperHmm : printHmm;
  const offX = guias ? (guias.marginLmm || 0) : 0;
  const offY = guias ? (guias.marginTmm || 0) : 0;
  const Wpx = Math.max(1, Math.round(mmToPx(hojaW, dpi)));
  const Hpx = Math.max(1, Math.round(mmToPx(hojaH, dpi)));
  canvas.width = Wpx; canvas.height = Hpx;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, Wpx, Hpx);

  if (guias) {
    // Lo que la impresora NO alcanza a marcar, apenas gris, para que se vea
    // cuánto margen queda de verdad.
    ctx.save();
    ctx.fillStyle = '#f1f2f4';
    ctx.fillRect(0, 0, Wpx, Hpx);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(mmToPx(offX, dpi), mmToPx(offY, dpi),
      mmToPx(printWmm, dpi), mmToPx(printHmm, dpi));
    ctx.restore();
    // El recuadro de CADA lugar, ocupado o no.
    ctx.save();
    ctx.strokeStyle = '#c7ccd4';
    ctx.lineWidth = Math.max(1, dpi / 110);
    ctx.setLineDash([dpi / 18, dpi / 24]);
    for (const pos of layout.positions) {
      ctx.strokeRect(mmToPx(pos.xMm + offX, dpi), mmToPx(pos.yMm + offY, dpi),
        mmToPx(pos.wMm, dpi), mmToPx(pos.hMm, dpi));
    }
    ctx.restore();
  }

  for (let i = 0; i < sheetPhotos.length; i++) {
    const pos = layout.positions[i];
    if (!pos) break;
    drawPhotoCell(ctx, sheetPhotos[i],
      mmToPx(pos.xMm + offX, dpi), mmToPx(pos.yMm + offY, dpi),
      mmToPx(pos.wMm, dpi), mmToPx(pos.hMm, dpi), framed);
  }
  return canvas;
}

export function canvasToPngArrayBuffer(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('no se pudo generar la hoja')); return; }
      blob.arrayBuffer().then(resolve, reject);
    }, 'image/png');
  });
}
