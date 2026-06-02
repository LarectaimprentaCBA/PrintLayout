import { detectFaces } from './faceDetection.js';
import { readImageDpi } from './imageMetadata.js';
import { prepareIncomingImageFiles } from './heic.js';

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
// 5) Si la imagen es mas grande que MAX_LONG_EDGE px de lado, la achica. La
//    impresion rasteriza a 240 DPI y exportamos a <=300 DPI; una foto de iPhone
//    (4032px) tiene mucho mas detalle del que cualquier impresion usa. Achicar
//    al tope no cambia la calidad impresa y baja MUCHO el peso (PNG sin
//    perdida pesa proporcional al numero de pixeles), por lo que armar el PDF
//    y mandarlo a la impresora es mucho mas rapido.
// MAX_LONG_EDGE = 3000px: a 240 DPI cubre una hoja A4 entera con margen, y a
// 300 DPI cubre fotos de hasta ~25 cm. Mas que suficiente para fotos.
const MAX_LONG_EDGE = 3000;

function normalizeImageToSrgb(img) {
  const canvas = document.createElement('canvas');
  // img puede ser HTMLImageElement (naturalWidth) o ImageBitmap (width).
  const srcW = img.naturalWidth ?? img.width;
  const srcH = img.naturalHeight ?? img.height;
  const longEdge = Math.max(srcW, srcH);
  const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Interpolacion de calidad al achicar (sino se ve dentado).
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

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

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  };
}

export async function readImageFile(file, opts = {}) {
  const { physicalSizeMmOverride } = opts;
  // createImageBitmap con colorSpaceConversion:'none' impide que Chromium
  // aplique la conversion ICC (Adobe RGB -> sRGB) que correria los blancos
  // (255,255,254) a (252,254,255). Asi los bytes del JPG entran intactos.
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none' });
  } catch (err) {
    throw new Error(`Imagen inválida: ${file.name}`);
  }
  // Dimensiones ORIGINALES (en px del archivo). Se usan solo para calcular el
  // tamano fisico a partir del DPI embebido (un dato del mundo real, ajeno a
  // nuestro reescalado interno).
  const w = bitmap.width;
  const h = bitmap.height;
  // normalizeImageToSrgb puede achicar la imagen; devuelve sus dimensiones
  // reales (nw, nh). El dataUrl, las caras y width/height del objeto resultante
  // viven todos en ese mismo espacio de pixeles, asi que recorte/caras quedan
  // consistentes.
  const { dataUrl: normalizedDataUrl, width: nw, height: nh } = normalizeImageToSrgb(bitmap);
  bitmap.close?.();

  const faces = await detectFaces(normalizedDataUrl);
  let physicalSizeMm = null;
  // physicalSizeMmTrusted: true cuando el tamano viene de una fuente confiable
  // (ej: rasterizacion de paginas de PDF, donde sabemos el tamano exacto).
  // Diferencia de cuando viene del DPI del JPG embebido, que tipicamente no
  // refleja el uso real y el editor tiene que aplicar heuristicas.
  let physicalSizeMmTrusted = false;
  // Si el caller pasa un override (ej: tamano fisico de la imagen en el PDF
  // de donde se extrajo), ese gana. El DPI del archivo embebido tipicamente
  // no refleja el uso real.
  if (physicalSizeMmOverride
      && Number.isFinite(physicalSizeMmOverride.w) && physicalSizeMmOverride.w > 0
      && Number.isFinite(physicalSizeMmOverride.h) && physicalSizeMmOverride.h > 0) {
    physicalSizeMm = {
      w: physicalSizeMmOverride.w,
      h: physicalSizeMmOverride.h,
    };
    physicalSizeMmTrusted = true;
  } else {
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
  }
  return {
    id: `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    dataUrl: normalizedDataUrl,
    width: nw,
    height: nh,
    mime: 'image/png',
    faces,
    physicalSizeMm,
    physicalSizeMmTrusted,
  };
}

export async function readImageFiles(fileList) {
  // Convierte HEIC/HEIF del iPhone a JPEG. Los que ya son jpg/png pasan igual.
  const arr = await prepareIncomingImageFiles(fileList);
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
