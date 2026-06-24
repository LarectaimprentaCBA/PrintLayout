// Trazado de contornos a partir de una imagen con canal alpha.
// Para el modo Stickers usamos SOLO ImageTracer (JS puro, Public Domain) — no
// requiere IPC al proceso main (a diferencia de Potrace en el lab). Devolvemos
// polígonos clasificados como outer/hole para offset y filtrado.
// Portado desde printlayout-contour-lab.

import ImageTracer from 'imagetracerjs'
import { pathDToSubpaths } from './offset.js'
import { classifyContours } from './geometry.js'

const MAX_TRACE_DIM = 1200

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
  ctx.drawImage(bitmap, 0, 0, width, height)

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

const POLY_SAMPLE_STEPS = 48

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
