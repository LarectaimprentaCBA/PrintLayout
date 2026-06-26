// Utilidades geométricas para clasificar polígonos como outer/hole.
// Trabajamos con la representación Clipper { X, Y } (enteros escalados).
// Portado desde printlayout-contour-lab (modo Stickers).

/** Área con signo (shoelace). Positivo = CCW, negativo = CW en coords Y-down. */
export function signedArea(poly) {
  let a = 0
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % n]
    a += p.X * q.Y - q.X * p.Y
  }
  return a / 2
}

export function polyArea(poly) {
  return Math.abs(signedArea(poly))
}

/** Centroide aproximado (promedio de vértices). */
export function polyCentroid(poly) {
  let cx = 0, cy = 0
  for (const p of poly) { cx += p.X; cy += p.Y }
  return { X: cx / poly.length, Y: cy / poly.length }
}

export function pointInPolygon(point, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].X, yi = poly[i].Y
    const xj = poly[j].X, yj = poly[j].Y
    const intersect = ((yi > point.Y) !== (yj > point.Y)) &&
      (point.X < ((xj - xi) * (point.Y - yi)) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Reorienta polígonos para Clipper: contorno externo con área POSITIVA (CCW) y
 * huecos con área NEGATIVA (CW). Clipper necesita ese giro opuesto para que, al
 * ofsetar, el hueco se mueva al revés que el contorno.
 */
export function orientForClipper(polys) {
  if (!polys || polys.length === 0) return []
  if (polys.length === 1) {
    return [signedArea(polys[0]) < 0 ? polys[0].slice().reverse() : polys[0]]
  }
  return classifyContours(polys).map((c) => {
    const a = signedArea(c.poly)
    const ok = c.isOuter ? a > 0 : a < 0
    return ok ? c.poly : c.poly.slice().reverse()
  })
}

/**
 * Clasifica polígonos en outer/inner usando containment.
 * Un polígono es "inner" (hole) si está dentro de un número impar de otros.
 * Devuelve [{ poly, idx, isOuter, containedBy, area }] ordenado por área desc.
 */
export function classifyContours(polys) {
  const withArea = polys.map((poly, idx) => ({
    poly,
    idx,
    area: polyArea(poly),
    centroid: polyCentroid(poly),
  }))
  withArea.sort((a, b) => b.area - a.area)

  return withArea.map((item) => {
    let containedBy = 0
    for (const other of withArea) {
      if (other.idx === item.idx) continue
      if (other.area <= item.area) continue
      if (pointInPolygon(item.centroid, other.poly)) containedBy++
    }
    return {
      poly: item.poly,
      idx: item.idx,
      isOuter: containedBy % 2 === 0,
      containedBy,
      area: item.area,
    }
  })
}
