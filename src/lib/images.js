import { detectFaces } from './faceDetection.js';
import { readImageDpi } from './imageMetadata.js';

export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}`));
    reader.onload = async () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = async () => {
        const faces = await detectFaces(dataUrl);
        // Intentar leer DPI declarado para deducir tamanio fisico.
        let physicalSizeMm = null;
        try {
          const dpi = await readImageDpi(file);
          if (dpi && dpi.xDpi > 0 && dpi.yDpi > 0) {
            physicalSizeMm = {
              w: (img.naturalWidth / dpi.xDpi) * 25.4,
              h: (img.naturalHeight / dpi.yDpi) * 25.4,
            };
          }
        } catch (err) {
          // Si falla el parser, seguimos sin tamanio fisico.
        }
        resolve({
          id: `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          dataUrl,
          width: img.naturalWidth,
          height: img.naturalHeight,
          mime: file.type || 'image/jpeg',
          faces,
          physicalSizeMm,
        });
      };
      img.onerror = () => reject(new Error(`Imagen inválida: ${file.name}`));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export async function readImageFiles(fileList) {
  const arr = Array.from(fileList);
  const results = [];
  for (const f of arr) {
    if (!/^image\/(jpe?g|png)$/i.test(f.type) && !/\.(jpe?g|png)$/i.test(f.name)) {
      console.warn(`Se ignoró ${f.name}: formato no soportado`);
      continue;
    }
    try {
      results.push(await readImageFile(f));
    } catch (err) {
      console.error(err);
    }
  }
  return results;
}
