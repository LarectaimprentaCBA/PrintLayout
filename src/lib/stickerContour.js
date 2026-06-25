// Orquestador del modo Stickers: convierte una imagen en (a) un PNG sin fondo
// para imprimir y (b) las polilíneas de su contorno de corte.
//
// Flujo: quita-fondo por color (flood-fill + huecos) -> trazado con ImageTracer
// -> polígonos clasificados (contorno externo + huecos). El contorno se devuelve
// en FRACCIONES (0..1) de la caja de la imagen, para que el caller lo mapee al
// rectángulo donde realmente se dibuja la imagen en la celda (encuadre 'contain'
// idéntico al de exportPdf), y así el corte calce con lo impreso.

import { solidBgRemoval } from './contour/solidBgRemoval.js'
import { traceContour } from './contour/trace.js'
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
export async function computeStickerContour(fileOrBlob, {
  tolerance = 32,
  engine = 'potrace',
  threshold = 128,
  turdsize = 2,
  alphamax = 1.0,
  opttolerance = 0.2,
} = {}) {
  const maskedBlob = await solidBgRemoval(fileOrBlob, {
    tolerance, detectHoles: true, defringe: true,
  })
  const result = await traceContour(maskedBlob, {
    engine, threshold, turdsize, alphamax, opttolerance,
    pathomit: Math.max(2, turdsize), // ImageTracer: descarta paths chicos
  })
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

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl)
  return res.blob()
}

/**
 * Genera template.cortes a partir de las imágenes asignadas a las celdas: por
 * cada celda con imagen, detecta su contorno (quita-fondo + trazado) y lo ubica
 * en la celda como polilíneas en mm. Celda sin imagen → sin corte. Si una imagen
 * falla, se saltea sin romper la hoja.
 *
 * @param {Array<string|null>} assignments - imageId por índice de celda
 * @param {Array<{x,y,w,h}>} cells - celdas en mm (mismo orden que assignments)
 * @param {Map<string, {dataUrl,width,height}>} imageMap
 * @param {object} opts
 * @param {number} opts.tolerance - tolerancia del quita-fondo (0..128)
 * @param {number} opts.bleedMm - sangrado del corte (mm); >0 afuera, <0 adentro
 * @param {boolean} opts.includeHoles - incluir huecos internos (orificio, etc.)
 * @param {Map} [opts.cache] - cache opcional por `${imageId}:${tolerance}` para
 *        que ajustar sangrado/huecos no re-trace (solo re-mapea, es instantáneo)
 * @returns {Promise<Array<Array<[number,number]>>>} polilíneas mm para template.cortes
 */
export async function contourCutsByAssignments(assignments, cells, imageMap, {
  params = {}, paramsByImage = null, cache = null, cacheOnly = false,
} = {}) {
  const cortes = []
  if (!Array.isArray(cells) || !imageMap) return cortes
  for (let i = 0; i < cells.length; i++) {
    const imgId = assignments?.[i]
    if (!imgId) continue
    const image = imageMap.get(imgId)
    if (!image?.dataUrl) continue
    const cell = cells[i]

    // Parámetros efectivos: default de hoja + override de esta imagen (si hay).
    const ov = paramsByImage && paramsByImage[imgId]
    const p = ov ? { ...params, ...ov } : params
    const engine = p.engine ?? 'potrace'
    const tolerance = p.tolerance ?? 32
    const threshold = p.threshold ?? 128
    const turdsize = p.turdsize ?? 2
    const alphamax = p.alphamax ?? 1.0
    const opttolerance = p.opttolerance ?? 0.2
    const bleedMm = p.bleedMm ?? 0
    const includeHoles = p.includeHoles !== false

    // Cache por IMAGEN con su "traceKey" (solo params que afectan el TRAZADO).
    // bleed/huecos NO entran al traceKey: cambiarlos re-mapea sobre el sc ya
    // trazado (instantáneo). En modo cacheOnly NO se traza: si no hay sc cacheado
    // para esa imagen, se saltea (lo usa el re-mapeo en vivo de sangría/huecos).
    const traceKey = `${engine}:${tolerance}:${threshold}:${turdsize}:${alphamax}:${opttolerance}`
    const cached = cache ? cache.get(imgId) : null
    let sc
    if (cached && cached.traceKey === traceKey) {
      sc = cached.sc
    } else if (cacheOnly) {
      sc = cached?.sc // usa lo último trazado, sin re-trazar
    } else {
      try {
        const blob = await dataUrlToBlob(image.dataUrl)
        sc = await computeStickerContour(blob, {
          engine, tolerance, threshold, turdsize, alphamax, opttolerance,
        })
        if (cache) cache.set(imgId, { sc, traceKey })
      } catch (e) {
        console.error('Contorno falló en celda', i, e)
        continue
      }
    }
    if (!sc) continue

    const contours = includeHoles ? sc.contours : sc.contours.filter(c => c.isOuter)
    const polys = contoursToCellCortes(contours, cell, sc.maskedW, sc.maskedH, { bleedMm })
    for (const p2 of polys) cortes.push(p2)
  }
  return cortes
}
