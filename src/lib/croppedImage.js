// Genera una version pre-recortada de una imagen para una celda especifica,
// aplicando crop manual y bleed. La imagen resultante tiene el tamanio
// (cellW + 2*bleed) x (cellH + 2*bleed) en mm, renderizada a una
// resolucion de DPI dada (default 300).
//
// El "crop" del image (imgX, imgY, imgW, imgH) en mm define donde se ubica
// la imagen original respecto al top-left de la celda. El canvas final
// tiene origen top-left = top-left de la zona de bleed.
export function generateCroppedImage(image, cellWmm, cellHmm, bleedMm = 0, dpi = 300) {
  return new Promise((resolve, reject) => {
    const sourceImg = new Image();
    sourceImg.onload = () => {
      const totalWmm = cellWmm + 2 * bleedMm;
      const totalHmm = cellHmm + 2 * bleedMm;
      const pxPerMm = dpi / 25.4;
      const canvasW = Math.max(1, Math.round(totalWmm * pxPerMm));
      const canvasH = Math.max(1, Math.round(totalHmm * pxPerMm));

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');

      const crop = image.crop;
      // Si no hay crop manual, usamos cover natural.
      let imgX, imgY, imgW, imgH;
      if (crop) {
        imgX = crop.imgX;
        imgY = crop.imgY;
        imgW = crop.imgW;
        imgH = crop.imgH;
      } else {
        const cellAr = cellWmm / cellHmm;
        const imgAr = sourceImg.naturalWidth / sourceImg.naturalHeight;
        if (imgAr > cellAr) {
          imgH = cellHmm;
          imgW = imgH * imgAr;
        } else {
          imgW = cellWmm;
          imgH = imgW / imgAr;
        }
        imgX = (cellWmm - imgW) / 2;
        imgY = (cellHmm - imgH) / 2;
      }

      // El canvas tiene origen en la esquina externa del bleed.
      // Trasladamos: la imagen va a (imgX + bleed, imgY + bleed) en mm.
      const drawX = (imgX + bleedMm) * pxPerMm;
      const drawY = (imgY + bleedMm) * pxPerMm;
      const drawW = imgW * pxPerMm;
      const drawH = imgH * pxPerMm;

      // Edge replicate: extender los pixeles del borde de la imagen para
      // rellenar las zonas del canvas que quedan fuera del rect (drawX..drawX+drawW).
      // Esto cubre tanto el bleed como cualquier "hueco" cuando la imagen
      // no cubre la celda completa.
      const sw = sourceImg.naturalWidth;
      const sh = sourceImg.naturalHeight;

      // Strips: top, bottom, left, right
      if (drawY > 0) {
        // Top strip: 1ra fila de la imagen estirada hacia arriba.
        ctx.drawImage(sourceImg, 0, 0, sw, 1, drawX, 0, drawW, drawY);
      }
      const bottomGap = canvasH - (drawY + drawH);
      if (bottomGap > 0) {
        ctx.drawImage(sourceImg, 0, sh - 1, sw, 1, drawX, drawY + drawH, drawW, bottomGap);
      }
      if (drawX > 0) {
        ctx.drawImage(sourceImg, 0, 0, 1, sh, 0, drawY, drawX, drawH);
      }
      const rightGap = canvasW - (drawX + drawW);
      if (rightGap > 0) {
        ctx.drawImage(sourceImg, sw - 1, 0, 1, sh, drawX + drawW, drawY, rightGap, drawH);
      }
      // Esquinas: 1 pixel estirado.
      if (drawX > 0 && drawY > 0) {
        ctx.drawImage(sourceImg, 0, 0, 1, 1, 0, 0, drawX, drawY);
      }
      if (rightGap > 0 && drawY > 0) {
        ctx.drawImage(sourceImg, sw - 1, 0, 1, 1, drawX + drawW, 0, rightGap, drawY);
      }
      if (drawX > 0 && bottomGap > 0) {
        ctx.drawImage(sourceImg, 0, sh - 1, 1, 1, 0, drawY + drawH, drawX, bottomGap);
      }
      if (rightGap > 0 && bottomGap > 0) {
        ctx.drawImage(sourceImg, sw - 1, sh - 1, 1, 1, drawX + drawW, drawY + drawH, rightGap, bottomGap);
      }

      // Imagen central por encima de los strips replicados.
      ctx.drawImage(sourceImg, drawX, drawY, drawW, drawH);

      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.92),
        widthMm: totalWmm,
        heightMm: totalHmm,
      });
    };
    sourceImg.onerror = () => reject(new Error('No se pudo procesar la imagen.'));
    sourceImg.src = image.dataUrl;
  });
}
