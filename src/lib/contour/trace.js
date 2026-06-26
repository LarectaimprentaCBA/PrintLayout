// Trazado de contornos a partir de una imagen con canal alpha.
// Para el modo Stickers usamos SOLO ImageTracer (JS puro, Public Domain) — no
// requiere IPC al proceso main (a diferencia de Potrace en el lab). Devolvemos
// polígonos clasificados como outer/hole para offset y filtrado.
// Portado desde printlayout-contour-lab.

import ImageTracer from 'imagetracerjs'
import { pathDToSubpaths } from './offset.js'
import { classifyContours } from './geometry.js'

// Potrace corre en el proceso main de Electron via IPC (mejores curvas que
// ImageTracer). `window.printlayout.contour.tracePotrace(arrayBuffer, opts) -> svg`
async function tracePotraceViaIPC(blob, opts) {
  if (!window.printlayout?.contour?.tracePotrace) {
    throw new Error('Potrace IPC no disponible (¿estás dentro de Electron?).')
  }
  const ab = await blob.arrayBuffer()
  return window.printlayout.contour.tracePotrace(ab, opts)
}

const MAX_TRACE_DIM = 700

async function buildAlphaMaskCanvas(blob, threshold = 128) {
  const bitmap = await createImageBitmap(blob)
  let { width, height } = bitmap
  const longSide = Math.max(width, height)
  let scale = 1
  if (longSide > MAX_TRACE_DIM) {
    scale = MAX_TRACE_DIM / longSide
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  // Anti-aliasing: un blur leve ANTES de binarizar lima la escalera de píxeles del
  // borde. Clave en imágenes pixeladas o de líneas finas (el borde entra ya
  // escalonado desde la imagen) → al binarizar al 50% la frontera queda más suave
  // y Potrace traza curvas más prolijas. En imágenes limpias el efecto es ínfimo.
  ctx.filter = 'blur(0.8px)'
  ctx.drawImage(bitmap, 0, 0, width, height)
  ctx.filter = 'none'

  const img = ctx.getImageData(0, 0, width, height)
  const data = img.data
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    // ImageTracer traza los NEGROS como "dentro".
    const v = a >= threshold ? 0 : 255
    data[i] = v
    data[i + 1] = v
    data[i + 2] = v
    data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return { canvas, scale, origWidth: bitmap.width, origHeight: bitmap.height }
}

function extractForegroundD(svgString) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString, 'image/svg+xml')
  const paths = Array.from(doc.querySelectorAll('path'))

  const isWhite = (fill) => {
    const f = (fill || '').toLowerCase().replace(/\s/g, '')
    return f === '#ffffff' || f === '#fff' || f === 'white' || f === 'rgb(255,255,255)'
  }

  let fgPaths = paths.filter(p => !isWhite(p.getAttribute('fill')))
  if (fgPaths.length === 0) fgPaths = paths

  return fgPaths.map(p => p.getAttribute('d')).filter(Boolean).join(' ')
}

// Puntos por cada curva al muestrear el contorno para el corte. 16 alcanza para
// que la línea salga suave a tamaño sticker, con MUCHOS menos puntos que 48 → la
// polilínea es más liviana (zoom más fluido, menos data al plotter, más rápido).
const POLY_SAMPLE_STEPS = 16

function postProcessTrace(svgString, width, height) {
  const fgD = extractForegroundD(svgString)
  const subpaths = pathDToSubpaths(fgD, POLY_SAMPLE_STEPS)
  const polygons = subpaths.map(s => s.poly)
  const classified = classifyContours(polygons)

  const isOuterByIndex = new Array(subpaths.length).fill(false)
  for (const c of classified) isOuterByIndex[c.idx] = c.isOuter

  const allD = subpaths.map(s => s.d).join(' ')
  const outerD = subpaths.filter((_, i) => isOuterByIndex[i]).map(s => s.d).join(' ')

  return { svg: svgString, polygons, classified, allD, outerD, width, height }
}

export async function traceWithPotrace(blob, opts = {}) {
  const {
    threshold = 128,
    turdsize = 2,
    alphamax = 1.0,
    opttolerance = 0.2,
  } = opts

  // Máscara B/N en el renderer; se manda como PNG al main para potrace.
  const { canvas } = await buildAlphaMaskCanvas(blob, threshold)
  const maskBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!maskBlob) throw new Error('No se pudo serializar la máscara a PNG.')

  const svgString = await tracePotraceViaIPC(maskBlob, {
    threshold: 128, // ya viene en B/N
    turdsize,
    alphamax,
    opttolerance,
  })

  return postProcessTrace(svgString, canvas.width, canvas.height)
}

// Dispatcher por motor. 'potrace' (curvas, via IPC) | 'imagetracer' (JS puro).
export async function traceContour(blob, { engine = 'potrace', ...opts } = {}) {
  if (engine === 'imagetracer') return traceWithImageTracer(blob, opts)
  return traceWithPotrace(blob, opts)
}

export async function traceWithImageTracer(blob, opts = {}) {
  const {
    threshold = 128,
    ltres = 1,
    qtres = 1,
    pathomit = 8,
  } = opts

  const { canvas } = await buildAlphaMaskCanvas(blob, threshold)
  const ctx = canvas.getContext('2d')
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const svgString = ImageTracer.imagedataToSVG(imageData, {
    ltres,
    qtres,
    pathomit,
    strokewidth: 1,
    numberofcolors: 2,
    colorsampling: 0,
    colorquantcycles: 1,
    viewbox: true,
    linefilter: false,
  })

  return postProcessTrace(svgString, canvas.width, canvas.height)
}
