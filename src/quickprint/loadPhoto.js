// Carga una foto para la ventana "Imprimir con PrintLayout": pide los bytes al
// main, convierte HEIC si hace falta, decodifica a ImageBitmap aplicando el
// perfil ICC (→sRGB) y la orientación EXIF, la limita a 3000 px de lado y detecta
// caras (para el recorte con foco). NO pasa por PNG dataURL (eso era lo lento).
import { prepareIncomingImageFiles } from '../lib/heic.js';
import { detectFacesFromInput } from '../lib/faceDetection.js';

const MAX_LONG_EDGE = 3000;

// Detecta caras sobre un canvas chico (rápido) y devuelve las cajas en px del
// bitmap capado (mismo espacio que usa el recorte).
async function facesOf(bitmap) {
  try {
    const long = Math.max(bitmap.width, bitmap.height);
    const s = long > 600 ? 600 / long : 1;
    const cw = Math.max(1, Math.round(bitmap.width * s));
    const ch = Math.max(1, Math.round(bitmap.height * s));
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, cw, ch);
    const faces = await detectFacesFromInput(canvas);
    return faces.map((f) => ({ x: f.x / s, y: f.y / s, width: f.width / s, height: f.height / s }));
  } catch (_) {
    return [];
  }
}

// item = { path, name }. detectarCaras: si false, no corre face-api (más rápido).
export async function loadPhoto(item, { detectarCaras = true } = {}) {
  const res = await window.printlayout.quickprint.readFile(item.path);
  if (!res || !res.ok) throw new Error(res?.error || 'no se pudo leer el archivo');
  let file = new File([res.bytes], item.name || 'foto', {});
  // HEIC/HEIF → JPEG (reusa el pipeline de la app).
  const [converted] = await prepareIncomingImageFiles([file]);
  if (!converted) throw new Error('no se pudo convertir el HEIC');
  file = converted;

  let bitmap = await createImageBitmap(file, {
    colorSpaceConversion: 'default',
    imageOrientation: 'from-image',
  });
  // Capar a 3000 px de lado (a 240 dpi cubre de sobra cualquier tamaño de foto).
  const long = Math.max(bitmap.width, bitmap.height);
  if (long > MAX_LONG_EDGE) {
    const s = MAX_LONG_EDGE / long;
    // Se achica DIBUJÁNDOLA en un lienzo, no con createImageBitmap({resize…}):
    // ese camino, con una foto girada por EXIF (los JPG de iPhone sacados en
    // vertical), aplica el tamaño ANTES del giro y la foto sale estirada (un
    // círculo queda ovalado). Dibujar respeta el giro. Hay una prueba con fotos
    // de ese tipo: npm run test:quickprint-fotos-giradas.
    const w = Math.max(1, Math.round(bitmap.width * s));
    const h = Math.max(1, Math.round(bitmap.height * s));
    const lienzo = new OffscreenCanvas(w, h);
    const ctx = lienzo.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const small = lienzo.transferToImageBitmap();
    bitmap.close?.();
    bitmap = small;
  }

  const faces = detectarCaras ? await facesOf(bitmap) : [];
  return {
    id: `${item.path}#${Math.random().toString(36).slice(2, 7)}`,
    name: item.name,
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    faces,
  };
}
