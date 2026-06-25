// Quita-fondo para diseños sobre fondo SÓLIDO (blanco u otro color plano).
// No usa IA: hace un flood-fill por color desde el borde de la imagen hacia
// adentro (tipo "varita mágica"). Solo borra el fondo contiguo al borde, así
// que el diseño se conserva. Además detecta HUECOS internos: regiones del color
// del fondo encerradas por el diseño (el orificio de una etiqueta, el centro de
// una "A") y, si superan un tamaño mínimo, las vuelve transparentes para que el
// contorno las pueda cortar. Devuelve un PNG con alpha a RESOLUCIÓN COMPLETA
// (el PDF embebe este blob al tamaño real, por eso no se escala).
//
// Portado tal cual desde printlayout-contour-lab (modo Stickers).

/**
 * Color modal (más frecuente) del anillo de borde, vía histograma grueso
 * (16 niveles por canal). Modal > promedio: robusto a un píxel raro del borde.
 */
export function detectBorderColor(data, w, h) {
  const bins = new Map()
  const add = (i) => {
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
    const e = bins.get(key)
    if (e) { e.c++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2] }
    else bins.set(key, { c: 1, r: data[i], g: data[i + 1], b: data[i + 2] })
  }
  for (let x = 0; x < w; x++) { add(x * 4); add(((h - 1) * w + x) * 4) }
  for (let y = 0; y < h; y++) { add((y * w) * 4); add((y * w + (w - 1)) * 4) }
  let best = null
  for (const e of bins.values()) if (!best || e.c > best.c) best = e
  return best
    ? { r: Math.round(best.r / best.c), g: Math.round(best.g / best.c), b: Math.round(best.b / best.c) }
    : { r: 255, g: 255, b: 255 }
}

/**
 * Núcleo PURO (sin canvas, testeable en Node): vuelve transparente el fondo
 * sólido de un buffer RGBA, in place. Devuelve el color de fondo usado.
 */
export function applySolidBgRemoval(data, w, h, {
  tolerance = 32,
  defringe = true,
  bgColor = null,
  detectHoles = true,
  minHoleFraction = 0.0005,
  minHoleSize = 64,
} = {}) {
  const bg = bgColor || detectBorderColor(data, w, h)
  const tol2 = tolerance * tolerance

  const isBg = (px) => {
    const i = px * 4
    if (data[i + 3] < 16) return true // ya transparente
    const dr = data[i] - bg.r, dg = data[i + 1] - bg.g, db = data[i + 2] - bg.b
    return dr * dr + dg * dg + db * db <= tol2
  }

  const visited = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)

  // (1) Fondo exterior: flood-fill conectado desde el borde (sin recursión).
  let sp = 0
  const pushIf = (px) => { if (!visited[px] && isBg(px)) { visited[px] = 1; stack[sp++] = px } }
  for (let x = 0; x < w; x++) { pushIf(x); pushIf((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { pushIf(y * w); pushIf(y * w + (w - 1)) }
  while (sp > 0) {
    const px = stack[--sp]
    data[px * 4 + 3] = 0
    const x = px % w, y = (px / w) | 0
    if (x > 0) pushIf(px - 1)
    if (x < w - 1) pushIf(px + 1)
    if (y > 0) pushIf(px - w)
    if (y < h - 1) pushIf(px + w)
  }

  // (2) Huecos internos: regiones del color del fondo ENCERRADAS por encima de
  // un tamaño mínimo. Reusa `stack` como cola BFS.
  if (detectHoles) {
    const minHole = Math.max(minHoleSize, Math.round(w * h * minHoleFraction))
    for (let start = 0; start < w * h; start++) {
      if (visited[start] || !isBg(start)) continue
      let n = 0
      visited[start] = 1
      stack[n++] = start
      for (let head = 0; head < n; head++) {
        const px = stack[head]
        const x = px % w, y = (px / w) | 0
        if (x > 0 && !visited[px - 1] && isBg(px - 1)) { visited[px - 1] = 1; stack[n++] = px - 1 }
        if (x < w - 1 && !visited[px + 1] && isBg(px + 1)) { visited[px + 1] = 1; stack[n++] = px + 1 }
        if (y > 0 && !visited[px - w] && isBg(px - w)) { visited[px - w] = 1; stack[n++] = px - w }
        if (y < h - 1 && !visited[px + w] && isBg(px + w)) { visited[px + w] = 1; stack[n++] = px + w }
      }
      if (n >= minHole) for (let k = 0; k < n; k++) data[stack[k] * 4 + 3] = 0
    }
  }

  // (3) Defringe: matar el halo de color del fondo en los bordes (antialias).
  if (defringe) {
    const alpha0 = new Uint8ClampedArray(w * h)
    for (let p = 0; p < w * h; p++) alpha0[p] = data[p * 4 + 3]
    const tol2b = (tolerance * 1.5) * (tolerance * 1.5)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        if (alpha0[p] === 0) continue
        const i = p * 4
        const dr = data[i] - bg.r, dg = data[i + 1] - bg.g, db = data[i + 2] - bg.b
        if (dr * dr + dg * dg + db * db > tol2b) continue
        const adj =
          (x > 0 && alpha0[p - 1] === 0) || (x < w - 1 && alpha0[p + 1] === 0) ||
          (y > 0 && alpha0[p - w] === 0) || (y < h - 1 && alpha0[p + w] === 0)
        if (adj) data[i + 3] = 0
      }
    }
  }

  return bg
}

// Resolución de trabajo del quita-fondo. 600px alcanza de sobra para el corte de
// un sticker (mucho más fino que la cuchilla del plotter) y hace el flood-fill ~3x
// más rápido que a 1000px (clave para que trazar no sea lento).
export const SOLID_WORKING_DIM = 600

/**
 * @param {File|Blob} fileOrBlob
 * @returns {Promise<Blob>} PNG con alpha, a la resolución de trabajo (≤ SOLID_WORKING_DIM)
 */
export async function solidBgRemoval(fileOrBlob, opts = {}) {
  const bitmap = await createImageBitmap(fileOrBlob)
  const scale = Math.min(1, SOLID_WORKING_DIM / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, w, h)

  const img = ctx.getImageData(0, 0, w, h)
  applySolidBgRemoval(img.data, w, h, opts)
  ctx.putImageData(img, 0, 0)

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('No se pudo serializar la imagen sin fondo sólido.')
  return blob
}
