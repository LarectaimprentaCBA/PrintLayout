// Crop a JPG/PNG dataUrl to a sub-rectangle and return the cropped dataUrl.
// pageRect is given in the same coordinate system as the source image filling.
// We assume the source image (at its natural size) maps 1:1 to viewBoxW × viewBoxH.

export async function cropImageDataUrl(dataUrl, pageRect, viewBoxW, viewBoxH) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('No se pudo abrir la imagen para recortar.'));
    i.src = dataUrl;
  });

  // Map viewBox (mm) coordinates to source image pixels.
  const scaleX = img.naturalWidth / viewBoxW;
  const scaleY = img.naturalHeight / viewBoxH;
  const sx = Math.max(0, Math.round(pageRect.x * scaleX));
  const sy = Math.max(0, Math.round(pageRect.y * scaleY));
  const sw = Math.max(1, Math.round(pageRect.w * scaleX));
  const sh = Math.max(1, Math.round(pageRect.h * scaleY));

  const clampedW = Math.min(sw, img.naturalWidth - sx);
  const clampedH = Math.min(sh, img.naturalHeight - sy);

  const canvas = document.createElement('canvas');
  canvas.width = clampedW;
  canvas.height = clampedH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, clampedW, clampedH);
  ctx.drawImage(img, sx, sy, clampedW, clampedH, 0, 0, clampedW, clampedH);
  return canvas.toDataURL('image/jpeg', 0.92);
}

export function dataUrlToBase64(dataUrl) {
  const c = dataUrl.indexOf(',');
  return c >= 0 ? dataUrl.slice(c + 1) : dataUrl;
}
