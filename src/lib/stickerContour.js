// Orquestador del modo Stickers: convierte una imagen en (a) un PNG sin fondo
// para imprimir y (b) las polilíneas de su contorno de corte.
//
// Flujo: quita-fondo por color (flood-fill + huecos) -> trazado con ImageTracer
// -> polígonos clasificados (contorno externo + huecos). El contorno se devuelve
// en FRACCIONES (0..1) de la caja de la imagen, para que el caller lo mapee al
// rectángulo donde realmente se dibuja la imagen en la celda (encuadre 'contain'
// idéntico al de exportPdf), y así el corte calce con lo impreso.

import { solidBgRemoval } from './contour/solidBgRemoval.js'
import { traceWithImageTracer } from './contour/trace.js'
import { offsetPolygons, CLIPPER_SCALE } from './contour/offset.js'

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = reject
    fr.readAsDataURL(blob)
  })
}

/**
 * Procesa una imagen y devuelve el PNG sin fondo + sus contornos en fracciones.
 *
 * @param {File|Blob} fileOrBlob
 * @param {object} opts
 * @param {number} opts.tolerance - tolerancia del quita-fondo por color (0..128)
 * @returns {Promise<{ maskedDataUrl:string, maskedW:number, maskedH:number,
 *   contours: Array<{ isOuter:boolean, area:number, points:Array<[number,number]> }> }>}
 */
export async function computeStickerContour(fileOrBlob, { tolerance = 32 } = {}) {
  const maskedBlob = await solidBgRemoval(fileOrBlob, {
    tolerance, detectHoles: true, defringe: true,
  })
  const result = await traceWithImageTracer(maskedBlob, { threshold: 128, pathomit: 8 })
  const W = result.width
  const H = result.height
  const maskedDataUrl = await blobToDataUrl(maskedBlob)

  // Filtra motas de ruido: descarta contornos con área < 0.2% del mayor.
  const maxArea = result.classified.reduce((m, c) => Math.max(m, c.area), 0) || 1
  const contours = result.classified
    .filter(c => c.area >= maxArea * 0.002)
    .map(c => ({
      isOuter: c.isOuter,
      area: c.area,
      // poly viene en unidades Clipper (px * 1000) sobre la caja W×H del trazado.
      points: c.poly.map(p => [p.X / (W * CLIPPER_SCALE), p.Y / (H * CLIPPER_SCALE)]),
    }))

  return { maskedDataUrl, maskedW: W, maskedH: H, contours }
}

/**
 * Mapea los contornos (en fracciones) al rectángulo donde se dibuja la imagen
 * dentro de la celda, con encuadre 'contain' (preserva aspecto, centrado) — el
 * mismo que usa exportPdf.fitContain. Devuelve polilíneas en mm (origen
 * arriba-izquierda de la hoja), listas para template.cortes. Si bleedMm != 0,
 * ofsetea (afuera>0 / adentro<0) tratando huecos al revés que el contorno.
 *
 * @param {Array<{points:Array<[number,number]>}>} contours - de computeStickerContour
 * @param {{x:number,y:number,w:number,h:number}} cell - celda en mm
 * @param {number} imgW - ancho px de la imagen (maskedW)
 * @param {number} imgH - alto px de la imagen (maskedH)
 * @param {object} opts
 * @param {number} opts.bleedMm - sangrado en mm (default 0 = silueta exacta)
 * @param {string} opts.joinType - 'round' | 'miter' | 'square' (para el sangrado)
 * @returns {Array<Array<[number,number]>>} polilíneas mm cerradas
 */
export function contoursToCellCortes(contours, cell, imgW, imgH, { bleedMm = 0, joinType = 'round' } = {}) {
  if (!contours?.length || !imgW || !imgH) return []
  // Encuadre 'contain': escala que entra en la celda preservando aspecto.
  const s = Math.min(cell.w / imgW, cell.h / imgH)
  const drawW = imgW * s
  const drawH = imgH * s
  const ox = cell.x + (cell.w - drawW) / 2
  const oy = cell.y + (cell.h - drawH) / 2

  const toMm = ([fx, fy]) => [ox + fx * drawW, oy + fy * drawH]
  const mmPolys = contours.map(c => c.points.map(toMm))

  if (!bleedMm) {
    // Asegura cierre (primer punto == último).
    return mmPolys.map(closePoly)
  }

  // Sangrado: pasa a unidades Clipper, ofsetea (auto-orienta huecos), vuelve a mm.
  const clip = mmPolys.map(poly => poly.map(([x, y]) => ({
    X: Math.round(x * CLIPPER_SCALE), Y: Math.round(y * CLIPPER_SCALE),
  })))
  const { polys } = offsetPolygons(clip, bleedMm, { joinType })
  return polys.map(poly => closePoly(poly.map(p => [p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE])))
}

function closePoly(poly) {
  if (poly.length < 2) return poly
  const a = poly[0]
  const b = poly[poly.length - 1]
  if (a[0] !== b[0] || a[1] !== b[1]) return [...poly, [a[0], a[1]]]
  return poly
}
