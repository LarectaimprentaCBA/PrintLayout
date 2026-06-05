import { detectFaces } from './faceDetection.js';
import { readImageDpi } from './imageMetadata.js';
import { prepareIncomingImageFiles } from './heic.js';
import { rasterizePdfPagesAt } from './pdfPreview.js';

// Re-codifica la imagen pasandola por canvas. Esto:
// 1) Descarta cualquier perfil ICC embebido (canvas siempre trabaja en sRGB),
//    asi los JPG con Adobe RGB de Corel dejan de salir shifteados en el PDF.
// 2) PRESERVA la transparencia (PNG circulares/recortados se editan como tales).
//    Antes aplanabamos contra blanco aca, pero eso rompia los PNG con alpha. El
//    blanco para impresion ya lo pone el rasterizador (pdfPreview.js rellena la
//    hoja de blanco antes de render), asi que no hace falta aplanar al cargar:
//    lo impreso sale igual y el editor muestra la transparencia real.
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
  // Sin relleno blanco: el canvas arranca transparente y drawImage conserva el
  // alpha del PNG. Para imagenes opacas (JPEG) el resultado es identico porque
  // cubren toda la superficie.
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

function isPdfFile(file) {
  return (file?.type || '').toLowerCase() === 'application/pdf'
    || /\.pdf$/i.test(file?.name || '');
}

// Carga UN archivo (imagen JPG/PNG/HEIC o PDF) y devuelve un objeto imagen
// listo para el editor. Para PDF rasteriza la PAGINA 1 a 300 DPI. Reusa el
// mismo pipeline (normalizacion sRGB + downscale + caras) via readImageFile.
export async function readAnyFileToImage(file) {
  if (isPdfFile(file)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pages = await rasterizePdfPagesAt(bytes, {
      dpi: 300,
      format: 'image/png',
      pageIndices: [1],
      as: 'arraybuffer',
    });
    const first = pages?.[0];
    if (!first?.buffer) throw new Error(`No se pudo leer el PDF: ${file.name}`);
    const baseName = (file.name || 'pdf').replace(/\.pdf$/i, '');
    const pngFile = new File([first.buffer], `${baseName}.png`, { type: 'image/png' });
    return readImageFile(pngFile);
  }
  // Imagen: convierte HEIC si hace falta y procesa.
  const [converted] = await prepareIncomingImageFiles([file]);
  if (!converted) throw new Error(`Archivo no soportado: ${file?.name}`);
  return readImageFile(converted);
}

// Carga varios archivos (imagenes y/o PDFs) a objetos imagen. Un PDF se
// expande a UNA imagen por pagina (300 DPI), util para "muchos frentes/dorsos
// en un PDF". Las imagenes pasan por el pipeline normal (HEIC, normalizacion,
// downscale). Devuelve la lista plana en el orden de entrada.
export async function readFilesToImages(fileList) {
  const files = Array.from(fileList || []);
  const out = [];
  for (const file of files) {
    try {
      if (isPdfFile(file)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const pages = await rasterizePdfPagesAt(bytes, {
          dpi: 300,
          format: 'image/png',
          pageIndices: null, // todas
          as: 'arraybuffer',
        });
        const baseName = (file.name || 'pdf').replace(/\.pdf$/i, '');
        for (const pg of pages) {
          if (!pg?.buffer) continue;
          const label = pages.length > 1 ? ` p${pg.pageIndex}` : '';
          const pngFile = new File([pg.buffer], `${baseName}${label}.png`, { type: 'image/png' });
          out.push(await readImageFile(pngFile));
        }
      } else {
        const [converted] = await prepareIncomingImageFiles([file]);
        if (converted) out.push(await readImageFile(converted));
      }
    } catch (err) {
      console.error(`No se pudo cargar ${file?.name}:`, err);
    }
  }
  return out;
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
