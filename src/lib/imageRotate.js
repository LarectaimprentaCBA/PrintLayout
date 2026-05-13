// Remapea bounding boxes de caras (x, y, w, h) por una rotacion 90 CW.
// La imagen vieja era (oldW x oldH); la nueva es (oldH x oldW).
// Conserva el resto de las propiedades de cada cara (ej. score).
export function rotateFaces90CW(faces, oldWidth, oldHeight) {
  if (!Array.isArray(faces) || faces.length === 0) return [];
  return faces.map((f) => ({
    ...f,
    x: oldHeight - (f.y + f.height),
    y: f.x,
    width: f.height,
    height: f.width,
  }));
}

// Rota una imagen (dataUrl) 90 grados en sentido horario y devuelve
// el nuevo dataUrl, ancho y alto.
export function rotateImageDataUrl90CW(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = h;
      canvas.height = w;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, h, w);
      ctx.translate(h / 2, w / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -w / 2, -h / 2);
      // PNG para preservar el snap-a-blanco-puro que hace normalizeImageToSrgb.
      // JPEG corre (255,255,255) a (254,254,254) por compresion y vuelve el bug.
      resolve({
        dataUrl: canvas.toDataURL('image/png'),
        width: h,
        height: w,
      });
    };
    img.onerror = () => reject(new Error('No se pudo rotar la imagen.'));
    img.src = dataUrl;
  });
}
