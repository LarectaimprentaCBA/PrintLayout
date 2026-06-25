// Offset / bleed de contornos usando Clipper.
// Portado desde printlayout-contour-lab (modo Stickers).

import ClipperLib from 'clipper-lib'
import { orientForClipper } from './geometry.js'

// Clipper usa coordenadas enteras para precisión. Escalamos x1000.
const SCALE = 1000

/**
 * Parsea un "d" y devuelve, por subpath, el d ORIGINAL (con curvas C/Q
 * preservadas y cerrado con un único Z) junto a su polígono muestreado {X,Y}.
 * Soporta M, L, H, V, Q, C, Z (uppercase = absoluto, lowercase = relativo).
 */
export function pathDToSubpaths(d, curveSteps = 24) {
  const tokens = d.match(/[a-zA-Z][^a-zA-Z]*/g) || []
  const subpaths = []
  let current = null
  let currentToks = null
  let cx = 0, cy = 0
  let startX = 0, startY = 0

  const push = (x, y) => {
    if (!current) return
    current.push({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) })
    cx = x; cy = y
  }

  const flush = () => {
    if (current && current.length > 1 && currentToks) {
      const sd = currentToks.join(' ').replace(/\s+/g, ' ').trim().replace(/\s*[Zz]\s*$/, '') + ' Z'
      subpaths.push({ d: sd, poly: current })
    }
    current = null
    currentToks = null
  }

  for (const tok of tokens) {
    const cmd = tok[0]
    const rest = tok.slice(1).trim()
    const nums = rest ? rest.split(/[\s,]+/).filter(Boolean).map(Number) : []
    const isRel = cmd === cmd.toLowerCase()

    if (cmd === 'M' || cmd === 'm') {
      flush()
      current = []
      currentToks = [tok]
      let i = 0
      let x = nums[i++], y = nums[i++]
      if (isRel) { x += cx; y += cy }
      startX = x; startY = y
      push(x, y)
      while (i < nums.length) {
        let lx = nums[i++], ly = nums[i++]
        if (isRel) { lx += cx; ly += cy }
        push(lx, ly)
      }
      continue
    }

    if (currentToks) currentToks.push(tok)

    switch (cmd.toUpperCase()) {
      case 'L': {
        for (let i = 0; i < nums.length; i += 2) {
          let x = nums[i], y = nums[i + 1]
          if (isRel) { x += cx; y += cy }
          push(x, y)
        }
        break
      }
      case 'H': {
        for (const n of nums) { const x = isRel ? cx + n : n; push(x, cy) }
        break
      }
      case 'V': {
        for (const n of nums) { const y = isRel ? cy + n : n; push(cx, y) }
        break
      }
      case 'Q': {
        for (let i = 0; i < nums.length; i += 4) {
          let qcx = nums[i], qcy = nums[i + 1], qx = nums[i + 2], qy = nums[i + 3]
          if (isRel) { qcx += cx; qcy += cy; qx += cx; qy += cy }
          const x0 = cx, y0 = cy
          for (let s = 1; s <= curveSteps; s++) {
            const t = s / curveSteps
            const mt = 1 - t
            const x = mt * mt * x0 + 2 * mt * t * qcx + t * t * qx
            const y = mt * mt * y0 + 2 * mt * t * qcy + t * t * qy
            push(x, y)
          }
        }
        break
      }
      case 'C': {
        for (let i = 0; i < nums.length; i += 6) {
          let c1x = nums[i], c1y = nums[i + 1]
          let c2x = nums[i + 2], c2y = nums[i + 3]
          let ex = nums[i + 4], ey = nums[i + 5]
          if (isRel) { c1x += cx; c1y += cy; c2x += cx; c2y += cy; ex += cx; ey += cy }
          const x0 = cx, y0 = cy
          for (let s = 1; s <= curveSteps; s++) {
            const t = s / curveSteps
            const mt = 1 - t
            const x = mt ** 3 * x0 + 3 * mt ** 2 * t * c1x + 3 * mt * t ** 2 * c2x + t ** 3 * ex
            const y = mt ** 3 * y0 + 3 * mt ** 2 * t * c1y + 3 * mt * t ** 2 * c2y + t ** 3 * ey
            push(x, y)
          }
        }
        break
      }
      case 'Z': {
        if (current && current.length > 0) {
          const last = current[current.length - 1]
          const firstX = Math.round(startX * SCALE)
          const firstY = Math.round(startY * SCALE)
          if (last.X !== firstX || last.Y !== firstY) current.push({ X: firstX, Y: firstY })
        }
        flush()
        cx = startX; cy = startY
        break
      }
      default:
        break
    }
  }
  flush()
  return subpaths
}

export function pathDToPolygons(d, curveSteps = 24) {
  return pathDToSubpaths(d, curveSteps).map(s => s.poly)
}

export function polygonsToPathD(polys) {
  const parts = []
  for (const poly of polys) {
    if (poly.length < 2) continue
    const cmds = poly.map((p, i) => {
      const x = (p.X / SCALE).toFixed(2)
      const y = (p.Y / SCALE).toFixed(2)
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    })
    parts.push(cmds.join(' ') + ' Z')
  }
  return parts.join(' ')
}

export function offsetPathD(d, deltaPx, { joinType = 'round', curveSteps = 24 } = {}) {
  const polys = pathDToPolygons(d, curveSteps)
  return offsetPolygons(polys, deltaPx, { joinType })
}

/**
 * Aplica offset a polígonos ya en coordenadas Clipper (escaladas x1000).
 * Orienta automáticamente (outer área+, hueco área−) para que el hueco se mueva
 * al revés que el contorno en vez de romperse.
 */
export function offsetPolygons(polys, deltaPx, { joinType = 'round' } = {}) {
  if (!polys || polys.length === 0) return { d: '', polys: [] }

  // ArcTolerance está en las MISMAS unidades que los polígonos (escaladas x1000).
  // 0.1mm = 100 → joins redondeados suaves con POCOS puntos. (Antes 0.05 = 0.05µm,
  // ultra-fino, generaba cientos de puntos por esquina = lento y pesado.)
  const co = new ClipperLib.ClipperOffset(2, 0.1 * SCALE)
  const jtMap = {
    round: ClipperLib.JoinType.jtRound,
    miter: ClipperLib.JoinType.jtMiter,
    square: ClipperLib.JoinType.jtSquare,
  }
  const jt = jtMap[joinType] ?? ClipperLib.JoinType.jtRound

  const oriented = orientForClipper(polys)
  co.AddPaths(oriented, jt, ClipperLib.EndType.etClosedPolygon)

  const solution = new ClipperLib.Paths()
  co.Execute(solution, deltaPx * SCALE)

  return { d: polygonsToPathD(solution), polys: solution }
}

/**
 * Une (Clipper Union) un conjunto de polígonos y devuelve SOLO los contornos
 * EXTERIORES (descarta huecos). Para el modo "silueta": al unir los contornos
 * exteriores del diseño, el más externo (anillo, heptágono, recuadro) se traga
 * lo de adentro y queda una sola marca exterior, sin cortes internos.
 * Devuelve polígonos en las mismas unidades Clipper (x1000).
 */
export function unionOuter(polys) {
  if (!polys || polys.length === 0) return []
  const cl = new ClipperLib.Clipper()
  cl.AddPaths(polys, ClipperLib.PolyType.ptSubject, true)
  const tree = new ClipperLib.PolyTree()
  cl.Execute(
    ClipperLib.ClipType.ctUnion,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  )
  const out = []
  const childs = tree.Childs() || []
  for (const child of childs) {
    // Los hijos de primer nivel son contornos exteriores; sus huecos (nietos) se
    // descartan → la silueta no tiene cortes internos.
    if (!child.IsHole()) out.push(child.Contour())
  }
  return out
}

export { SCALE as CLIPPER_SCALE }
