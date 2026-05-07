import * as faceapi from 'face-api.js';

const MODEL_URL = './models';
const MIN_CONFIDENCE = 0.4;

let loadPromise = null;
let loaded = false;

function ensureModelLoaded() {
  if (loaded) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = faceapi.nets.ssdMobilenetv1
      .loadFromUri(MODEL_URL)
      .then(() => {
        loaded = true;
      })
      .catch((err) => {
        loadPromise = null;
        throw err;
      });
  }
  return loadPromise;
}

function loadHtmlImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo decodificar la imagen para detectar caras.'));
    img.src = dataUrl;
  });
}

export async function detectFaces(dataUrl) {
  try {
    await ensureModelLoaded();
    const img = await loadHtmlImage(dataUrl);
    const options = new faceapi.SsdMobilenetv1Options({
      minConfidence: MIN_CONFIDENCE,
    });
    const detections = await faceapi.detectAllFaces(img, options);
    return detections.map((d) => ({
      x: Math.round(d.box.x),
      y: Math.round(d.box.y),
      width: Math.round(d.box.width),
      height: Math.round(d.box.height),
      score: Math.round(d.score * 100) / 100,
    }));
  } catch (err) {
    console.warn('[faceDetection] falló la detección:', err);
    return [];
  }
}

export function focalPoint(image) {
  const bbox = facesBoundingBox(image?.faces, 0);
  if (bbox) {
    return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
  }
  return { x: (image?.width ?? 1) / 2, y: (image?.height ?? 1) / 2 };
}

export function coverObjectPosition(image, cellWidth, cellHeight) {
  if (!image || !image.width || !image.height) return { x: 50, y: 50 };
  const iw = image.width;
  const ih = image.height;
  const scale = Math.max(cellWidth / iw, cellHeight / ih);
  const overflowX = iw * scale - cellWidth;
  const overflowY = ih * scale - cellHeight;
  const f = focalPoint(image);
  const desiredX = Math.max(0, Math.min(overflowX, f.x * scale - cellWidth / 2));
  const desiredY = Math.max(0, Math.min(overflowY, f.y * scale - cellHeight / 2));
  return {
    x: overflowX > 0.001 ? (desiredX / overflowX) * 100 : 50,
    y: overflowY > 0.001 ? (desiredY / overflowY) * 100 : 50,
  };
}

export function coverCropRect(image, cellWidth, cellHeight) {
  if (!image || !image.width || !image.height) return null;
  const iw = image.width;
  const ih = image.height;
  const cellAr = cellWidth / cellHeight;
  const imgAr = iw / ih;
  let cropW;
  let cropH;
  if (imgAr > cellAr) {
    cropH = ih;
    cropW = ih * cellAr;
  } else {
    cropW = iw;
    cropH = iw / cellAr;
  }
  const f = focalPoint(image);
  let x = f.x - cropW / 2;
  let y = f.y - cropH / 2;
  x = Math.max(0, Math.min(iw - cropW, x));
  y = Math.max(0, Math.min(ih - cropH, y));
  return { x, y, w: cropW, h: cropH };
}

export function facesBoundingBox(faces, padding = 0.15) {
  if (!faces || faces.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of faces) {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.width);
    maxY = Math.max(maxY, f.y + f.height);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const padW = w * padding;
  const padH = h * padding;
  return {
    x: minX - padW,
    y: minY - padH,
    width: w + 2 * padW,
    height: h + 2 * padH,
  };
}
