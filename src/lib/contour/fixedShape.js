// Corte de FORMA FIJA para UNA imagen dentro de una hoja que corta por contorno.
//
// Para qué: hay stickers donde detectar la silueta no sirve (fondo que se
// confunde con el dibujo, foto a sangre, degradés…). En vez de pelear con la
// tolerancia, esa imagen se corta como rectángulo / círculo / óvalo alrededor de
// DONDE SE IMPRIME, sin trazar nada. El resto de la hoja sigue por contorno.
//
// Es geometría pura (sin canvas ni trazado) → es instantáneo, no depende del
// caché de trazado y se puede testear en Node.

import { cellsToRoundedRectCuts } from '../grid.js'
import { intersectPolys, CLIPPER_SCALE } from './offset.js'

export const FIXED_SHAPES = ['rect', 'circle', 'oval']

export function isFixedShape(shape) {
  return FIXED_SHAPES.includes(shape)
}

/**
 * Rectángulo (mm) donde queda impresa la imagen dentro de la celda. Mismo
 * criterio que la vista previa y el PDF: el borde blanco achica la caja; en
 * "Rellenar" (cover) la imagen ocupa toda esa caja; en "Enteras" (contain) entra
 * completa y centrada. `rotated` = el casillero la muestra girada 90°.
 */
export function imageBoxInCell(cell, imgW, imgH, { fit = 'contain', borderMm = 0, rotated = false } = {}) {
  const bWanted = Math.max(0, Number(borderMm) || 0)
  const b = bWanted > 0 ? Math.min(bWanted, Math.max(0, Math.min(cell.w, cell.h) / 2 - 0.2)) : 0
  const inner = { x: cell.x + b, y: cell.y + b, w: cell.w - 2 * b, h: cell.h - 2 * b }
  const iw = rotated ? Number(imgH) : Number(imgW)
  const ih = rotated ? Number(imgW) : Number(imgH)
  if (fit === 'cover' || !(iw > 0) || !(ih > 0)) return inner
  const s = Math.min(inner.w / iw, inner.h / ih)
  const w = iw * s
  const h = ih * s
  return { x: inner.x + (inner.w - w) / 2, y: inner.y + (inner.h - h) / 2, w, h }
}

/**
 * Polilíneas de corte (mm, cerradas) de una forma fija alrededor de la imagen.
 *
 * @param {{x,y,w,h}} cell - celda en mm
 * @param {number} imgW - ancho px de la imagen
 * @param {number} imgH - alto px de la imagen
 * @param {object} opts
 * @param {'rect'|'circle'|'oval'} opts.shape - 'circle' = círculo de verdad
 *        (diámetro = lado más corto de la imagen); 'oval' = toca los 4 lados.
 * @param {number} opts.bleedMm - >0 agranda (corta por afuera), <0 achica
 * @param {number} opts.cornerRadiusMm - solo 'rect': radio de las esquinas
 * @param {Array<[number,number]>} [opts.clipPoly] - forma del casillero ("Limitar
 *        a la forma"); si viene, el corte no se sale de ella
 * @returns {Array<Array<[number,number]>>}
 */
export function fixedShapeCortes(cell, imgW, imgH, {
  shape = 'rect', bleedMm = 0, cornerRadiusMm = 0,
  fit = 'contain', borderMm = 0, rotated = false, clipPoly = null,
} = {}) {
  if (!cell || !isFixedShape(shape)) return []
  const img = imageBoxInCell(cell, imgW, imgH, { fit, borderMm, rotated })
  const d = Number(bleedMm) || 0
  const box = { x: img.x - d, y: img.y - d, w: img.w + 2 * d, h: img.h + 2 * d }
  if (!(box.w > 0.2) || !(box.h > 0.2)) return []

  let poly
  if (shape === 'circle') {
    const r = Math.min(box.w, box.h) / 2
    poly = ovalPoly({ x: box.x + box.w / 2 - r, y: box.y + box.h / 2 - r, w: 2 * r, h: 2 * r })
  } else if (shape === 'oval') {
    poly = ovalPoly(box)
  } else {
    const r = Math.max(0, Number(cornerRadiusMm) || 0)
    poly = r > 0
      ? cellsToRoundedRectCuts([box], { cornerRadiusMm: r, segmentsPerCorner: 12 })[0]
      : [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h], [box.x, box.y]]
  }
  if (!poly || poly.length < 4) return []

  if (clipPoly && clipPoly.length >= 3) {
    const toC = (pts) => pts.map(([x, y]) => ({ X: Math.round(x * CLIPPER_SCALE), Y: Math.round(y * CLIPPER_SCALE) }))
    const limited = intersectPolys([toC(poly)], [toC(clipPoly)], { includeHoles: false })
    return limited.map((p) => close(p.map((q) => [q.X / CLIPPER_SCALE, q.Y / CLIPPER_SCALE])))
  }
  return [close(poly)]
}

function ovalPoly(box, segments = 96) {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const rx = box.w / 2
  const ry = box.h / 2
  const out = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  out.push([out[0][0], out[0][1]]) // cierre EXACTO (sin el error de coma flotante de cos(2π))
  return out
}

function close(poly) {
  if (poly.length < 2) return poly
  const a = poly[0]
  const b = poly[poly.length - 1]
  if (a[0] !== b[0] || a[1] !== b[1]) return [...poly, [a[0], a[1]]]
  return poly
}
