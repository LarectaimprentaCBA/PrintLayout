// Utilidades de recorte para el modal de crop manual del sidebar.
// Hay tres operaciones:
//   - cropRectFromDataUrl: crop rectangular puro.
//   - cropPolygonFromDataUrl: crop con mascara poligonal (PNG transparente
//     afuera del poligono, recortado al bounding box).
//   - detectUniformBorder: analiza pixeles del borde para proponer un rect
//     interno (sirve para tarjetas escaneadas con marco blanco/negro/solido).

async function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo abrir la imagen.'));
    img.src = dataUrl;
  });
}

function clampRect(rect, width, height) {
  const x = Math.max(0, Math.min(width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(rect.y)));
  const w = Math.max(1, Math.min(width - x, Math.round(rect.w)));
  const h = Math.max(1, Math.min(height - y, Math.round(rect.h)));
  return { x, y, w, h };
}

// Crop rectangular. Devuelve PNG (preserva 255 puro de fondos blancos como
// hace cropImageDataUrl original).
export async function cropRectFromDataUrl(dataUrl, rectPx) {
  const img = await loadImage(dataUrl);
  const { x, y, w, h } = clampRect(rectPx, img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

// Crop poligonal. `pointsPx` puede ser:
//   - un solo polígono: array de {x,y} en px de la imagen original (legacy), o
//   - un SET de contornos: array de polígonos (cada uno array de {x,y}) — para el
//     modo "Contorno" (varios exteriores + huecos). Con `evenOdd` en el clip los
//     huecos quedan transparentes (calado) y las formas separadas se recortan todas.
// Devuelve PNG con alpha=0 afuera de la silueta, recortado al bounding box común.
export async function cropPolygonFromDataUrl(dataUrl, pointsPx, { evenOdd = false } = {}) {
  // Normalizar a lista de polígonos. Un solo polígono llega como [{x,y}, ...]
  // (pointsPx[0] es un objeto); un set llega como [[{x,y}...], [{x,y}...]].
  const polys = (Array.isArray(pointsPx) && Array.isArray(pointsPx[0]))
    ? pointsPx
    : [pointsPx];
  const shapes = polys.filter((p) => Array.isArray(p) && p.length >= 3);
  if (shapes.length === 0) {
    throw new Error('El polígono necesita al menos 3 puntos.');
  }
  const img = await loadImage(dataUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;

  // Bounding box común a TODOS los polígonos.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const shape of shapes) {
    for (const p of shape) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const bx = Math.max(0, Math.floor(minX));
  const by = Math.max(0, Math.floor(minY));
  const bw = Math.max(1, Math.min(W - bx, Math.ceil(maxX - bx)));
  const bh = Math.max(1, Math.min(H - by, Math.ceil(maxY - by)));

  const canvas = document.createElement('canvas');
  canvas.width = bw;
  canvas.height = bh;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.save();
  ctx.beginPath();
  for (const shape of shapes) {
    for (let i = 0; i < shape.length; i++) {
      const px = shape[i].x - bx;
      const py = shape[i].y - by;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  ctx.clip(evenOdd ? 'evenodd' : 'nonzero');
  ctx.drawImage(img, -bx, -by);
  ctx.restore();

  return { dataUrl: canvas.toDataURL('image/png'), width: bw, height: bh };
}

// Crop elíptico: recorta al rect y enmascara con la elipse INSCRITA en ese rect
// (círculo si el rect es cuadrado). Devuelve PNG con alpha=0 afuera de la elipse.
export async function cropEllipseFromDataUrl(dataUrl, rectPx) {
  const img = await loadImage(dataUrl);
  const { x, y, w, h } = clampRect(rectPx, img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  ctx.restore();
  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

// Distancia "perceptual" simple entre dos RGB en [0,255]. Suficiente para
// decidir si un pixel es "borde" o "contenido" cuando el marco es uniforme.
function colorDist(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// Lee el color de una esquina (cuadrado de N px). Devuelve {r,g,b}.
function sampleCornerColor(data, W, H, corner, sampleSize) {
  let xs, ys;
  if (corner === 'tl') { xs = 0; ys = 0; }
  else if (corner === 'tr') { xs = W - sampleSize; ys = 0; }
  else if (corner === 'bl') { xs = 0; ys = H - sampleSize; }
  else { xs = W - sampleSize; ys = H - sampleSize; }
  xs = Math.max(0, xs);
  ys = Math.max(0, ys);
  const xe = Math.min(W, xs + sampleSize);
  const ye = Math.min(H, ys + sampleSize);
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = ys; y < ye; y++) {
    for (let x = xs; x < xe; x++) {
      const i = (y * W + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  return { r: r / n, g: g / n, b: b / n };
}

// Detecta un borde uniforme y devuelve el rect interno (en pixeles de la
// imagen original). Si no encuentra borde claro, devuelve null.
//
// Estrategia:
// 1. Bajamos a una resolucion de trabajo (max 800px lado largo) para velocidad.
// 2. Sampleamos las 4 esquinas. Si difieren mucho entre si (no hay marco
//    uniforme), devolvemos null.
// 3. Color de referencia = promedio de esquinas. Tolerancia configurable.
// 4. Por cada lado, escaneamos hacia adentro fila/columna por fila/columna,
//    contando cuantos pixeles difieren del color de borde mas que tolerancia.
//    El primer scan que supera el threshold marca el limite.
// 5. Devolvemos el rect resultante reescalado a la resolucion original.
//
// opts: { tolerance = 18, contentThreshold = 0.04, sampleSize = 6 }
//   tolerance: distancia RGB minima para que un pixel cuente como "contenido".
//   contentThreshold: fraccion de pixeles "contenido" en una fila/columna
//     para considerarla parte del contenido (no borde).
//   sampleSize: tamano del cuadrado por esquina para promediar.
export async function detectUniformBorder(dataUrl, opts = {}) {
  const {
    tolerance = 18,
    contentThreshold = 0.04,
    sampleSize = 6,
    cornerVariance = 22,
  } = opts;
  const img = await loadImage(dataUrl);
  const W0 = img.naturalWidth;
  const H0 = img.naturalHeight;
  if (W0 < 20 || H0 < 20) return null;

  // Bajamos resolucion para acelerar el scan.
  const MAX = 800;
  const scale = Math.min(1, MAX / Math.max(W0, H0));
  const W = Math.max(20, Math.round(W0 * scale));
  const H = Math.max(20, Math.round(H0 * scale));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;

  const tl = sampleCornerColor(data, W, H, 'tl', sampleSize);
  const tr = sampleCornerColor(data, W, H, 'tr', sampleSize);
  const bl = sampleCornerColor(data, W, H, 'bl', sampleSize);
  const br = sampleCornerColor(data, W, H, 'br', sampleSize);

  const avgR = (tl.r + tr.r + bl.r + br.r) / 4;
  const avgG = (tl.g + tr.g + bl.g + br.g) / 4;
  const avgB = (tl.b + tr.b + bl.b + br.b) / 4;

  // Si las esquinas no son coherentes entre si, no hay marco uniforme.
  const maxCornerDist = Math.max(
    colorDist(tl.r, tl.g, tl.b, avgR, avgG, avgB),
    colorDist(tr.r, tr.g, tr.b, avgR, avgG, avgB),
    colorDist(bl.r, bl.g, bl.b, avgR, avgG, avgB),
    colorDist(br.r, br.g, br.b, avgR, avgG, avgB),
  );
  if (maxCornerDist > cornerVariance) return null;

  // Scan top
  let top = 0;
  for (let y = 0; y < H; y++) {
    let nContent = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (colorDist(data[i], data[i + 1], data[i + 2], avgR, avgG, avgB) > tolerance) {
        nContent++;
      }
    }
    if (nContent / W > contentThreshold) { top = y; break; }
    top = y;
  }

  // Scan bottom
  let bottom = H - 1;
  for (let y = H - 1; y >= 0; y--) {
    let nContent = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (colorDist(data[i], data[i + 1], data[i + 2], avgR, avgG, avgB) > tolerance) {
        nContent++;
      }
    }
    if (nContent / W > contentThreshold) { bottom = y; break; }
    bottom = y;
  }

  // Scan left
  let left = 0;
  for (let x = 0; x < W; x++) {
    let nContent = 0;
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      if (colorDist(data[i], data[i + 1], data[i + 2], avgR, avgG, avgB) > tolerance) {
        nContent++;
      }
    }
    if (nContent / H > contentThreshold) { left = x; break; }
    left = x;
  }

  // Scan right
  let right = W - 1;
  for (let x = W - 1; x >= 0; x--) {
    let nContent = 0;
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      if (colorDist(data[i], data[i + 1], data[i + 2], avgR, avgG, avgB) > tolerance) {
        nContent++;
      }
    }
    if (nContent / H > contentThreshold) { right = x; break; }
    right = x;
  }

  // Si el rect resultante es casi igual al total, no hay borde util.
  if (left >= right - 4 || top >= bottom - 4) return null;
  const innerW = right - left + 1;
  const innerH = bottom - top + 1;
  if (innerW / W > 0.985 && innerH / H > 0.985) return null;

  // Reescalamos a la resolucion original.
  const invScale = 1 / scale;
  const xs = Math.max(0, Math.round(left * invScale));
  const ys = Math.max(0, Math.round(top * invScale));
  const xe = Math.min(W0, Math.round((right + 1) * invScale));
  const ye = Math.min(H0, Math.round((bottom + 1) * invScale));
  return { x: xs, y: ys, w: xe - xs, h: ye - ys };
}
