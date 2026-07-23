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
import { mergeContours, CLIPPER_SCALE } from './contour/offset.js'

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
  // detectHoles SIEMPRE on: necesitamos la geometría REAL del diseño (el aro como
  // banda, los contadores de las letras como huecos) para que la sangría pueda
  // crecer y cerrarlos. `includeHoles` (Keep Holes) ya NO cambia la máscara: solo
  // decide, al final del mapeo, si esos huecos se cortan o no.
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
  const toFrac = (poly) => poly.map(p => [p.X / (W * CLIPPER_SCALE), p.Y / (H * CLIPPER_SCALE)])

  // TODAS las formas (exteriores + huecos), sin unir ni descartar: la unión se
  // hace en el mapeo, DESPUÉS de aplicar la sangría (así se fusiona lo que se toca
  // al crecer). Solo se filtran motas muy chicas.
  const maxArea = result.classified.reduce((m, c) => Math.max(m, c.area), 0) || 1
  const contours = result.classified
    .filter(c => c.area >= maxArea * 0.0008)
    .map(c => ({ isOuter: c.isOuter, area: c.area, points: toFrac(c.poly) }))

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
export function contoursToCellCortes(contours, cell, imgW, imgH, { bleedMm = 0, includeHoles = false, smoothMm = 0, joinType = 'round' } = {}) {
  if (!contours?.length || !imgW || !imgH) return []
  // Encuadre 'contain': escala que entra en la celda preservando aspecto.
  const s = Math.min(cell.w / imgW, cell.h / imgH)
  const drawW = imgW * s
  const drawH = imgH * s
  const ox = cell.x + (cell.w - drawW) / 2
  const oy = cell.y + (cell.h - drawH) / 2

  // Todas las formas a unidades Clipper (mm x1000) en su lugar dentro de la celda.
  const clip = contours.map(c => c.points.map(([fx, fy]) => ({
    X: Math.round((ox + fx * drawW) * CLIPPER_SCALE),
    Y: Math.round((oy + fy * drawH) * CLIPPER_SCALE),
  })))

  // Agranda por la sangría, une lo que se toca y SIMPLIFICA la línea final (RDP).
  // Con includeHoles OFF solo quedan los contornos de afuera (lo de adentro no se corta).
  const merged = mergeContours(clip, bleedMm, { joinType, includeHoles, simplifyMm: smoothMm })
  return merged.map(poly => closePoly(poly.map(p => [p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE])))
}

/**
 * Contornos (fracciones 0..1) → polilíneas en PÍXELES de la imagen (imgW×imgH),
 * con offset/sangría (afuera>0, adentro<0) + huecos, reusando el MISMO motor que
 * el corte por contorno del plotter (mergeContours: offset Clipper + unión +
 * clasificación exterior/hueco). Lo usa el modo "Contorno" del recorte de imagen:
 * la misma geometría se dibuja como línea roja (preview) y se usa como clip al
 * hornear el PNG → lo que ves es lo que recorta.
 *
 * @returns {Array<Array<[number,number]>>} polilíneas cerradas en px
 */
export function contoursToPixelPolys(contours, imgW, imgH, { offsetPx = 0, includeHoles = false, joinType = 'round', smoothPx = 0 } = {}) {
  if (!contours?.length || !imgW || !imgH) return []
  const clip = contours.map(c => c.points.map(([fx, fy]) => ({
    X: Math.round(fx * imgW * CLIPPER_SCALE),
    Y: Math.round(fy * imgH * CLIPPER_SCALE),
  })))
  // deltaPx/simplifyMm de mergeContours están en las MISMAS unidades sin escalar
  // que los polígonos → acá son PÍXELES (no mm).
  const merged = mergeContours(clip, offsetPx, { joinType, includeHoles, simplifyMm: smoothPx })
  return merged.map(poly => closePoly(poly.map(p => [p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE])))
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
  // Dedup por (imagen + tamaño de celda + params): una hoja con 15 celdas IGUALES
  // calcula el contorno UNA sola vez y lo TRASLADA a cada celda (antes se recalculaba
  // el merge+RDP 15 veces → era la causa principal de la lentitud al mover sliders).
  const mapCache = new Map()
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
    const includeHoles = p.includeHoles === true
    // Tolerancia de simplificación (mm). Valores viejos del Chaikin (escala 0–3)
    // quedarían enormes para RDP → facetado; los normalizo al default.
    let smoothMm = p.smoothMm ?? 0.12
    if (!(smoothMm >= 0 && smoothMm <= 0.5)) smoothMm = 0.12

    // Cache por IMAGEN con su "traceKey" = SOLO los params que afectan el TRAZADO.
    // sangría/huecos/suavizado NO entran: son mapeo (re-unen sobre el sc ya
    // trazado = instantáneo). En cacheOnly NO se traza: si no hay sc, se saltea.
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

    // Calcula el contorno UNA vez por (imagen + tamaño de celda + params) en una
    // celda en el origen, y para cada celda solo TRASLADA por (cell.x, cell.y).
    // El merge+RDP (lo caro) corre una sola vez aunque la hoja tenga 15 iguales.
    const cw = Math.round(cell.w * 100), ch = Math.round(cell.h * 100)
    const mapKey = `${imgId}:${cw}:${ch}:${bleedMm}:${includeHoles}:${smoothMm}`
    let base = mapCache.get(mapKey)
    if (!base) {
      base = contoursToCellCortes(sc.contours, { x: 0, y: 0, w: cell.w, h: cell.h }, sc.maskedW, sc.maskedH, { bleedMm, includeHoles, smoothMm })
      mapCache.set(mapKey, base)
    }
    for (const poly of base) cortes.push(poly.map(([x, y]) => [x + cell.x, y + cell.y]))
  }
  return cortes
}
