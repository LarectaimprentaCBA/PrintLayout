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

// Dibuja UNA hoja en el canvas dado. layout.positions en mm relativas al área
// imprimible (printWmm × printHmm).
export function renderSheetToCanvas(canvas, sheetPhotos, layout, printWmm, printHmm, dpi, framed) {
  const Wpx = Math.max(1, Math.round(mmToPx(printWmm, dpi)));
  const Hpx = Math.max(1, Math.round(mmToPx(printHmm, dpi)));
  canvas.width = Wpx; canvas.height = Hpx;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, Wpx, Hpx);
  for (let i = 0; i < sheetPhotos.length; i++) {
    const pos = layout.positions[i];
    if (!pos) break;
    drawPhotoCell(ctx, sheetPhotos[i],
      mmToPx(pos.xMm, dpi), mmToPx(pos.yMm, dpi),
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
