// Sangrado de COLOR para stickers cortados por contorno.
//
// El problema: un sticker de forma libre sobre fondo blanco. Si el corte va justo
// por el borde del dibujo, cualquier corrimiento del plotter deja un filo blanco;
// para evitarlo había que meter el corte hacia adentro (comiéndose el diseño) o
// armar el sangrado a mano en tres pasos. Acá se hace solo: alrededor de la
// silueta que YA detecta el corte se pinta una franja de N mm con el color del
// propio borde (rosa donde el borde es rosa, rojo donde es rojo). El diseño no
// se achica ni se mueve y la línea de corte no cambia.
//
// Este archivo tiene (a) el cálculo PURO, testeable en Node, y (b) el armado de
// la imagen con canvas (solo navegador), con caché por imagen + parámetros.

import { solidBgRemoval } from './solidBgRemoval.js'
import { nearestOpaqueSeeds } from '../imageBleed.js'
import { isFixedShape } from './fixedShape.js'

const OPACO = 250

/**
 * PURO. Achica la silueta 1 px (erosión 3×3 del alfa), in place. El borde de un
 * dibujo sobre blanco siempre trae una línea de píxeles "lavados" (mezcla con el
 * fondo); sacándola, el color que se estira es el del dibujo y no ese gris.
 */
export function erodeAlpha(data, W, H) {
  const a0 = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) a0[p] = data[p * 4 + 3]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x
      let m = a0[p]
      if (m === 0) continue
      for (let dy = -1; dy <= 1 && m > 0; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= H) { m = 0; break }
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= W) { m = 0; break }
          const v = a0[yy * W + xx]
          if (v < m) m = v
        }
      }
      data[p * 4 + 3] = m
    }
  }
  return data
}

/**
 * PURO. Pinta la franja, in place, sobre un RGBA W×H que tiene el dibujo opaco
 * y el resto transparente:
 *   - lo opaco queda como está;
 *   - lo que está a `radiusPx` o menos del dibujo toma el color del borde más
 *     cercano (muestreado `insetPx` hacia adentro, para no agarrar el filo);
 *   - lo que está más lejos queda transparente.
 * El borde de afuera de la franja se suaviza en 1 px.
 */
export function paintHalo(data, W, H, { radiusPx, insetPx = 2, threshold = OPACO } = {}) {
  const R = Math.max(0, Number(radiusPx) || 0)
  const { seedX, seedY } = nearestOpaqueSeeds(data, W, H, threshold)
  const N = W * H
  // Los colores se leen de una copia: si no, un píxel ya pintado podría servir
  // de muestra para el siguiente.
  const src = new Uint8ClampedArray(data)
  for (let i = 0; i < N; i++) {
    if (src[i * 4 + 3] >= threshold) { data[i * 4 + 3] = 255; continue }
    const sx = seedX[i]
    if (sx < 0) { data[i * 4 + 3] = 0; continue }
    const sy = seedY[i]
    const x = i % W, y = (i / W) | 0
    const vx = sx - x, vy = sy - y
    const dist = Math.sqrt(vx * vx + vy * vy)
    if (dist > R + 0.5) { data[i * 4 + 3] = 0; continue }
    // Muestra un poco adentro del borde, en la dirección píxel → borde.
    let si = sy * W + sx
    if (insetPx > 0 && dist >= 0.5) {
      const px = Math.round(sx + (vx / dist) * insetPx)
      const py = Math.round(sy + (vy / dist) * insetPx)
      if (px >= 0 && px < W && py >= 0 && py < H) {
        const ci = py * W + px
        if (src[ci * 4 + 3] >= threshold) si = ci
      }
    }
    data[i * 4] = src[si * 4]
    data[i * 4 + 1] = src[si * 4 + 1]
    data[i * 4 + 2] = src[si * 4 + 2]
    const fuera = dist - (R - 0.5) // 0..1 en el último píxel de la franja
    data[i * 4 + 3] = fuera <= 0 ? 255 : Math.round(255 * (1 - Math.min(1, fuera)))
  }
  return data
}

/**
 * PURO. Cuánto puede salirse la franja de cada celda sin pisar a la vecina:
 * hasta `maxMm`, y nunca más que la MITAD del hueco con la celda de al lado.
 * Devuelve por celda { l, t, r, b } en mm (≥ 0).
 */
export function bleedAllowances(cells, maxMm) {
  const M = Math.max(0, Number(maxMm) || 0)
  return (cells || []).map((c, i) => {
    let l = M, t = M, r = M, b = M
    for (let j = 0; j < cells.length; j++) {
      if (j === i) continue
      const o = cells[j]
      // Vecina "al costado" = sus alturas se cruzan (contando la franja).
      const cruzaY = o.y < c.y + c.h + M && o.y + o.h > c.y - M
      const cruzaX = o.x < c.x + c.w + M && o.x + o.w > c.x - M
      if (cruzaY) {
        if (o.x >= c.x + c.w - 1e-6) r = Math.min(r, Math.max(0, (o.x - (c.x + c.w)) / 2))
        else if (o.x + o.w <= c.x + 1e-6) l = Math.min(l, Math.max(0, (c.x - (o.x + o.w)) / 2))
      }
      if (cruzaX) {
        if (o.y >= c.y + c.h - 1e-6) b = Math.min(b, Math.max(0, (o.y - (c.y + c.h)) / 2))
        else if (o.y + o.h <= c.y + 1e-6) t = Math.min(t, Math.max(0, (c.y - (o.y + o.h)) / 2))
      }
    }
    return { l, t, r, b }
  })
}

/**
 * PURO. ¿Va franja de color en esta celda? Devuelve los parámetros o null.
 * Misma regla para la vista en pantalla y para lo que se imprime.
 *
 * No va (queda todo como siempre) si: la hoja no es de corte por contorno, el
 * valor es 0, la imagen tiene forma fija, no entra "entera" (rellenar/recortar),
 * tiene borde blanco, o el casillero la muestra girada.
 */
export function colorBleedFor(template, imgId, { fitMode = 'contain', borderMm = 0, rotated = false } = {}) {
  if (!template || template.cutShape !== 'contour') return null
  const mm = Number(template.contourColorBleedMm) || 0
  if (!(mm > 0)) return null
  if (fitMode === 'cover' || borderMm > 0 || rotated) return null
  const ov = (template.contourByImage && template.contourByImage[imgId]) || null
  if (ov && isFixedShape(ov.shape)) return null
  const outerBorder = (ov?.outerBorder ?? template.contourOuterBorder ?? true) === true
  const includeHoles = outerBorder ? false : ((ov?.includeHoles ?? template.contourIncludeHoles) === true)
  const cutOffsetMm = Number(ov?.bleedMm ?? template.contourBleedMm) || 0
  return {
    tolerance: ov?.tolerance ?? template.contourTolerance ?? 32,
    // Un hueco interno solo se pinta si se CORTA (es descarte). Si no se corta
    // es parte del sticker y tiene que quedar como está.
    detectHoles: includeHoles,
    // La franja se cuenta desde la LÍNEA DE CORTE: si el corte va por afuera del
    // dibujo (sangrado positivo), el color llega hasta el corte y sigue N mm más.
    haloMm: Math.min(20, mm + Math.max(0, cutOffsetMm)),
    maxMm: Math.min(20, mm + Math.max(0, cutOffsetMm)),
  }
}

/**
 * PURO. La franja más ancha que puede pedir esta hoja (mm), contando el
 * sangrado del corte de la hoja y el de cada imagen. 0 = la hoja no usa franja.
 */
export function maxHaloMm(template) {
  if (!template || template.cutShape !== 'contour') return 0
  const mm = Number(template.contourColorBleedMm) || 0
  if (!(mm > 0)) return 0
  let off = Math.max(0, Number(template.contourBleedMm) || 0)
  for (const o of Object.values(template.contourByImage || {})) {
    off = Math.max(off, Number(o?.bleedMm) || 0)
  }
  return Math.min(20, mm + off)
}

/**
 * PURO. Dónde va la imagen con franja dentro de la celda (encuadre "entera",
 * igual que exportPdf.fitContain y que el mapeo del corte). `padFrac` = cuánto
 * se agrandó la imagen de cada lado, como fracción de su ancho.
 * Devuelve { x, y, w, h } en mm de la hoja.
 */
export function bleedPlacement(cell, imgW, imgH, padFrac) {
  const s = Math.min(cell.w / imgW, cell.h / imgH)
  const drawW = imgW * s, drawH = imgH * s
  const ox = cell.x + (cell.w - drawW) / 2
  const oy = cell.y + (cell.h - drawH) / 2
  const pad = padFrac * drawW
  return { x: ox - pad, y: oy - pad, w: drawW + 2 * pad, h: drawH + 2 * pad, padMm: pad }
}

// ── Armado de la imagen (navegador) ─────────────────────────────────────────

const cache = new Map() // clave → Promise<resultado>
const MAX_CACHE = 120
const MAX_LADO = 4096

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('no se pudo leer la imagen'))
    im.src = src
  })
}

async function construir(image, { tolerance, detectHoles, haloMm }, cellW, cellH) {
  const blob = await (await fetch(image.dataUrl)).blob()
  // La MISMA silueta que usa el corte (misma tolerancia, misma resolución).
  const maskBlob = await solidBgRemoval(blob, { tolerance, detectHoles, defringe: true })
  const mask = await createImageBitmap(maskBlob)
  const w = mask.width, h = mask.height

  // mm → px de trabajo: la imagen entra "entera" en la celda.
  const drawWmm = Math.min(cellW / w, cellH / h) * w
  const pxPorMm = w / drawWmm
  const p = Math.max(1, Math.min(Math.round(haloMm * pxPorMm), Math.round(Math.max(w, h) * 0.6)))
  const W = w + 2 * p, H = h + 2 * p

  // Franja + dibujo a resolución de trabajo.
  const cH = document.createElement('canvas')
  cH.width = W; cH.height = H
  const xH = cH.getContext('2d', { willReadFrequently: true })
  xH.drawImage(mask, p, p)
  const id = xH.getImageData(0, 0, W, H)
  erodeAlpha(id.data, W, H)
  // Silueta achicada, para recortar el original después (antes de pintar la franja).
  const cM = document.createElement('canvas')
  cM.width = W; cM.height = H
  cM.getContext('2d').putImageData(id, 0, 0)
  paintHalo(id.data, W, H, { radiusPx: p, insetPx: Math.max(2, Math.round(0.25 * pxPorMm)) })
  xH.putImageData(id, 0, 0)

  // Salida a la resolución del ORIGINAL (el dibujo no pierde definición).
  const original = await loadImg(image.dataUrl)
  let k = original.naturalWidth / w
  if (Math.max(W, H) * k > MAX_LADO) k = MAX_LADO / Math.max(W, H)
  const FW = Math.max(1, Math.round(W * k)), FH = Math.max(1, Math.round(H * k))
  const cF = document.createElement('canvas')
  cF.width = FW; cF.height = FH
  const xF = cF.getContext('2d')
  xF.imageSmoothingEnabled = true
  xF.imageSmoothingQuality = 'high'
  xF.drawImage(cH, 0, 0, FW, FH)

  // El original, recortado por la silueta, encima de la franja.
  const cD = document.createElement('canvas')
  cD.width = FW; cD.height = FH
  const xD = cD.getContext('2d')
  xD.imageSmoothingEnabled = true
  xD.imageSmoothingQuality = 'high'
  xD.drawImage(original, p * k, p * k, w * k, h * k)
  xD.globalCompositeOperation = 'destination-in'
  xD.drawImage(cM, 0, 0, FW, FH)
  xF.drawImage(cD, 0, 0)
  mask.close?.()

  const out = await new Promise((resolve) => cF.toBlob(resolve, 'image/png'))
  if (!out) throw new Error('no se pudo armar la franja de color')
  const bytes = new Uint8Array(await out.arrayBuffer())
  return { url: URL.createObjectURL(out), bytes, width: FW, height: FH, padFrac: p / w, imgW: w, imgH: h }
}

/**
 * Imagen del sticker con su franja de color (PNG con transparencia), cacheada.
 * @param {{id:string, dataUrl:string}} image
 * @param {{tolerance:number, detectHoles:boolean, haloMm:number}} params - de colorBleedFor
 * @param {number} cellW - ancho de la celda (mm)
 * @param {number} cellH - alto de la celda (mm)
 * @returns {Promise<{url:string, bytes:Uint8Array, width:number, height:number,
 *   padFrac:number, imgW:number, imgH:number}>}
 */
export function getColorBleedImage(image, params, cellW, cellH) {
  const key = [image.id, (image.dataUrl || '').length, params.tolerance, params.detectHoles ? 'H' : 'B',
    Math.round(params.haloMm * 100), Math.round(cellW * 10), Math.round(cellH * 10)].join('|')
  let pr = cache.get(key)
  if (!pr) {
    pr = construir(image, params, cellW, cellH)
    pr.catch(() => { if (cache.get(key) === pr) cache.delete(key) })
    cache.set(key, pr)
    if (cache.size > MAX_CACHE) {
      const vieja = cache.keys().next().value
      const pv = cache.get(vieja)
      cache.delete(vieja)
      if (pv) pv.then((r) => { try { URL.revokeObjectURL(r.url) } catch (_) { /* noop */ } }).catch(() => {})
    }
  } else {
    // Recién usada → al final de la fila (no se descarta mientras se usa).
    cache.delete(key); cache.set(key, pr)
  }
  return pr
}
