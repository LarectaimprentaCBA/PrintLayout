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

/**
 * Reproduce el "Create Contour": agranda TODAS las formas por la sangría, las
 * UNE (lo que al crecer se toca se fusiona; si cierra un hueco, la figura cierra)
 * y devuelve las líneas de corte finales (en unidades Clipper x1000).
 *
 * - `deltaPx`: sangría en mm (>0 afuera, <0 adentro).
 * - `simplifyMm`: tolerancia de simplificación (Ramer–Douglas–Peucker) en mm
 *   reales del corte. Saca el ruido/escalera del trazado y baja MUCHO la cantidad
 *   de puntos → línea más limpia y menos movimientos del plóter. 0 = sin tocar.
 * - `includeHoles`: false (default) = SOLO el contorno de afuera (todo lo que
 *   queda encerrado adentro es parte impresa, no se corta). true = también corta
 *   los huecos y las formas internas.
 */
export function mergeContours(polys, deltaPx, { joinType = 'round', includeHoles = false, simplifyMm = 0 } = {}) {
  if (!polys || polys.length === 0) return []
  const jtMap = {
    round: ClipperLib.JoinType.jtRound,
    miter: ClipperLib.JoinType.jtMiter,
    square: ClipperLib.JoinType.jtSquare,
  }
  const jt = jtMap[joinType] ?? ClipperLib.JoinType.jtRound

  // ArcTolerance 0.1mm = joins redondeados suaves con pocos puntos.
  const offsetBy = (paths, delta) => {
    const co = new ClipperLib.ClipperOffset(2, 0.1 * SCALE)
    co.AddPaths(paths, jt, ClipperLib.EndType.etClosedPolygon)
    const sol = new ClipperLib.Paths()
    co.Execute(sol, delta * SCALE)
    return sol
  }

  let merged = orientForClipper(polys)
  if (deltaPx) merged = offsetBy(merged, deltaPx) // sangría: agranda y une lo que se toca
  if (!merged.length) return []

  // Union → PolyTree para clasificar bien exterior/hueco (incluso anidados).
  const cl = new ClipperLib.Clipper()
  cl.AddPaths(merged, ClipperLib.PolyType.ptSubject, true)
  const tree = new ClipperLib.PolyTree()
  cl.Execute(
    ClipperLib.ClipType.ctUnion,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  )

  const out = []
  if (includeHoles) {
    // Todo: exteriores + huecos + formas internas (corta también lo de adentro).
    const walk = (node) => {
      for (const child of node.Childs() || []) {
        const c = child.Contour()
        if (c && c.length >= 3) out.push(c)
        walk(child)
      }
    }
    walk(tree)
  } else {
    // Solo el corte de AFUERA: contornos de primer nivel. Todo lo encerrado
    // adentro (texto, adornos, huecos) NO se corta = parte impresa del sticker.
    for (const child of tree.Childs() || []) {
      if (child.IsHole()) continue
      const c = child.Contour()
      if (c && c.length >= 3) out.push(c)
    }
  }

  // Línea de corte limpia y suave en dos pasos:
  //  1) RDP: saca el ruido/escalera del trazado → de miles de puntos a decenas
  //     de puntos CLAVE (epsilon en mm reales; clamp 0.5mm por seguridad).
  //  2) Chaikin: redondea esos puntos clave en una curva suave (C1) → la línea
  //     deja de verse facetada/"cuadrada". Como RDP ya bajó muchísimo los puntos,
  //     el ×4 del Chaikin (2 iter) queda en pocos cientos = liviano para el plóter.
  if (simplifyMm > 0 && out.length) {
    const eps = Math.min(simplifyMm, 0.5) * SCALE
    return out
      .map(p => {
        const key = rdpClosed(p, eps)
        // Chaikin solo cuando RDP dejó POCOS puntos clave. Si quedaron muchos
        // (tolerancia por debajo del ruido), la línea ya es densa: no la
        // multipliquemos ×4 (evita que el conteo explote a miles).
        return (key.length >= 6 && key.length <= 250) ? chaikinClosed(key, 2) : key
      })
      .filter(p => p.length >= 3)
  }
  return out
}

/**
 * Suavizado Chaikin para un anillo CERRADO (corner-cutting): cada iteración
 * reemplaza cada vértice por dos puntos a 1/4 y 3/4 de sus aristas → la poligonal
 * se redondea hacia una B-spline. Solo interpola entre puntos existentes: nunca
 * crea picos ni ángulos nuevos. Cada iteración multiplica los puntos por 2.
 */
function chaikinClosed(poly, iterations) {
  let pts = poly
  for (let it = 0; it < iterations; it++) {
    const n = pts.length
    if (n < 3) break
    const next = []
    for (let i = 0; i < n; i++) {
      const p = pts[i]
      const q = pts[(i + 1) % n]
      next.push({ X: Math.round(0.75 * p.X + 0.25 * q.X), Y: Math.round(0.75 * p.Y + 0.25 * q.Y) })
      next.push({ X: Math.round(0.25 * p.X + 0.75 * q.X), Y: Math.round(0.25 * p.Y + 0.75 * q.Y) })
    }
    pts = next
  }
  return pts
}

/**
 * RDP iterativo sobre una polilínea ABIERTA de puntos {X,Y}. Conserva los
 * extremos y los vértices cuya distancia perpendicular a la cuerda supera eps.
 */
function rdpOpen(pts, eps) {
  const n = pts.length
  if (n < 3) return pts.slice()
  const keep = new Uint8Array(n)
  keep[0] = 1; keep[n - 1] = 1
  const eps2 = eps * eps
  const stack = [[0, n - 1]]
  while (stack.length) {
    const seg = stack.pop()
    const s = seg[0], e = seg[1]
    const ax = pts[s].X, ay = pts[s].Y
    const dx = pts[e].X - ax, dy = pts[e].Y - ay
    const len2 = dx * dx + dy * dy || 1
    let dmax = -1, idx = -1
    for (let i = s + 1; i < e; i++) {
      const t = ((pts[i].X - ax) * dx + (pts[i].Y - ay) * dy) / len2
      const px = ax + t * dx, py = ay + t * dy
      const ex = pts[i].X - px, ey = pts[i].Y - py
      const d = ex * ex + ey * ey
      if (d > dmax) { dmax = d; idx = i }
    }
    if (idx > 0 && dmax > eps2) {
      keep[idx] = 1
      stack.push([s, idx]); stack.push([idx, e])
    }
  }
  const out = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i])
  return out
}

/**
 * RDP para un anillo CERRADO (sin punto de cierre duplicado): lo parte en dos
 * cadenas por el punto más lejano al inicial, simplifica cada una y recombina.
 * Así la simplificación no depende de dónde arranca el anillo.
 */
function rdpClosed(ring, eps) {
  const n = ring.length
  if (n < 5) return ring
  let far = 0, fd = -1
  for (let i = 1; i < n; i++) {
    const dx = ring[i].X - ring[0].X, dy = ring[i].Y - ring[0].Y
    const d = dx * dx + dy * dy
    if (d > fd) { fd = d; far = i }
  }
  const s1 = rdpOpen(ring.slice(0, far + 1), eps)
  const s2 = rdpOpen(ring.slice(far).concat([ring[0]]), eps)
  return s1.slice(0, -1).concat(s2.slice(0, -1))
}

export { SCALE as CLIPPER_SCALE }
