import { detectFaces } from './faceDetection.js';
import { readImageDpi } from './imageMetadata.js';

// Re-codifica la imagen pasandola por canvas. Esto:
// 1) Descarta cualquier perfil ICC embebido (canvas siempre trabaja en sRGB),
//    asi los JPG con Adobe RGB de Corel dejan de salir shifteados en el PDF.
// 2) Aplana transparencia contra fondo blanco (PNG ya no sale negro).
// 3) "Snappea" pixeles casi-blancos a (255,255,255) exactos. Corel exporta
//    JPGs con blanco = (255,255,254) que en RGB->CMYK le pide una pizca de
//    tinta al driver y sale azulado en papel. Llevandolo a blanco puro, el
//    driver no deposita tinta y se ve el papel.
// 4) Sale como PNG porque JPEG, aun en quality 1.0, puede correr el (255,255,255)
//    snapeado de vuelta a (254,254,254) por la compresion.
function normalizeImageToSrgb(img) {
  const canvas = document.createElement('canvas');
  // img puede ser HTMLImageElement (naturalWidth) o ImageBitmap (width).
  canvas.width = img.naturalWidth ?? img.width;
  canvas.height = img.naturalHeight ?? img.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  // Snap conservador: solo pixeles donde min(R,G,B) >= 253 y la dispersion
  // entre canales es <= 2. Asi atrapamos (255,255,254) y artefactos JPEG
  // alrededor del blanco, sin tocar contenido legitimo casi-blanco.
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const SNAP_MIN = 253;
  const SNAP_DEV = 2;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    if (min >= SNAP_MIN && max - min <= SNAP_DEV) {
      px[i] = 255;
      px[i + 1] = 255;
      px[i + 2] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);

  return canvas.toDataURL('image/png');
}

export async function readImageFile(file) {
  // createImageBitmap con colorSpaceConversion:'none' impide que Chromium
  // aplique la conversion ICC (Adobe RGB -> sRGB) que correria los blancos
  // (255,255,254) a (252,254,255). Asi los bytes del JPG entran intactos.
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none' });
  } catch (err) {
    throw new Error(`Imagen inválida: ${file.name}`);
  }
  const w = bitmap.width;
  const h = bitmap.height;
  const normalizedDataUrl = normalizeImageToSrgb(bitmap);
  bitmap.close?.();

  const faces = await detectFaces(normalizedDataUrl);
  let physicalSizeMm = null;
  try {
    const dpi = await readImageDpi(file);
    if (dpi && dpi.xDpi > 0 && dpi.yDpi > 0) {
      physicalSizeMm = {
        w: (w / dpi.xDpi) * 25.4,
        h: (h / dpi.yDpi) * 25.4,
      };
    }
  } catch (err) {
    // Si falla el parser, seguimos sin tamanio fisico.
  }
  return {
    id: `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    dataUrl: normalizedDataUrl,
    width: w,
    height: h,
    mime: 'image/png',
    faces,
    physicalSizeMm,
  };
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
