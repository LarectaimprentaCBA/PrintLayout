// Extiende una imagen al tamanio fisico objetivo agregando bordes con
// edge replicate. La imagen modificada reemplaza al dataUrl original.
//
// Tambien soporta recortar si el target es mas chico que el original
// (la imagen queda centrada y se recortan los bordes).
//
// originalSizeMm: { w, h } -> tamanio fisico que se asume tiene la imagen.
// targetSizeMm: { w, h } -> tamanio fisico que queremos para la salida.
export function extendImageToSize(dataUrl, originalSizeMm, targetSizeMm) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const sw = img.naturalWidth;
        const sh = img.naturalHeight;

        // Calcular px/mm a partir del tamanio que el usuario declaro.
        // Si el aspect del archivo no coincide con el aspect declarado,
        // usamos el factor mas alto para no perder calidad.
        const pxPerMmW = sw / originalSizeMm.w;
        const pxPerMmH = sh / originalSizeMm.h;
        const pxPerMm = Math.max(pxPerMmW, pxPerMmH);

        // Pixeles del canvas final.
        const canvasW = Math.max(1, Math.round(targetSizeMm.w * pxPerMm));
        const canvasH = Math.max(1, Math.round(targetSizeMm.h * pxPerMm));

        // Pixeles que ocupa la imagen original re-escalada al sistema final.
        const drawW = originalSizeMm.w * pxPerMm;
        const drawH = originalSizeMm.h * pxPerMm;
        // Centrada.
        const drawX = (canvasW - drawW) / 2;
        const drawY = (canvasH - drawH) / 2;

        const canvas = document.createElement('canvas');
        canvas.width = canvasW;
        canvas.height = canvasH;
        const ctx = canvas.getContext('2d');

        // Edge replicate solo si target > original en algun lado.
        if (drawX > 0 || drawY > 0
            || drawX + drawW < canvasW || drawY + drawH < canvasH) {
          // Top/bottom strips.
          if (drawY > 0) {
            ctx.drawImage(img, 0, 0, sw, 1, drawX, 0, drawW, drawY);
          }
          const bottomGap = canvasH - (drawY + drawH);
          if (bottomGap > 0) {
            ctx.drawImage(img, 0, sh - 1, sw, 1, drawX, drawY + drawH, drawW, bottomGap);
          }
          if (drawX > 0) {
            ctx.drawImage(img, 0, 0, 1, sh, 0, drawY, drawX, drawH);
          }
          const rightGap = canvasW - (drawX + drawW);
          if (rightGap > 0) {
            ctx.drawImage(img, sw - 1, 0, 1, sh, drawX + drawW, drawY, rightGap, drawH);
          }
          // Esquinas (1 pixel estirado).
          if (drawX > 0 && drawY > 0) {
            ctx.drawImage(img, 0, 0, 1, 1, 0, 0, drawX, drawY);
          }
          if (rightGap > 0 && drawY > 0) {
            ctx.drawImage(img, sw - 1, 0, 1, 1, drawX + drawW, 0, rightGap, drawY);
          }
          if (drawX > 0 && bottomGap > 0) {
            ctx.drawImage(img, 0, sh - 1, 1, 1, 0, drawY + drawH, drawX, bottomGap);
          }
          if (rightGap > 0 && bottomGap > 0) {
            ctx.drawImage(img, sw - 1, sh - 1, 1, 1, drawX + drawW, drawY + drawH, rightGap, bottomGap);
          }
        }

        // Imagen central. drawImage clipea automaticamente cuando dest
        // queda parcialmente fuera del canvas (caso target < original).
        ctx.drawImage(img, drawX, drawY, drawW, drawH);

        resolve({
          dataUrl: canvas.toDataURL('image/jpeg', 0.95),
          width: canvasW,
          height: canvasH,
          sizeMm: { w: targetSizeMm.w, h: targetSizeMm.h },
        });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('No se pudo procesar la imagen.'));
    img.src = dataUrl;
  });
}
