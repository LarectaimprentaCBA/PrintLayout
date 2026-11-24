// Zona segura (la línea verde punteada): cada corte "achicado" hacia adentro.
//
// En una hoja de stickers iguales, todos los cortes son la MISMA forma corrida de
// lugar. Achicar un contorno de ~1400 puntos es caro (Clipper), y antes se hacía
// una vez POR sticker: con 96 stickers eran 96 cálculos idénticos (~2,3 s con la
// pantalla congelada en cada clic del sangrado). Acá se calcula una vez por forma
// distinta y a las demás solo se las traslada.

import { offsetPolygons } from './contour/offset.js'

const ESCALA = 1000 // mm → unidades Clipper (igual que antes)

// Cuánto pueden diferir dos cortes (mm, punto a punto, ya puestos en el mismo
// origen) para tomarlos por la misma forma. Los cortes de una hoja se guardan
// con las coordenadas de CADA celda, así que entre un sticker y otro hay
// diferencias de redondeo de milésimas: comparar exacto no los reconocía.
const TOLERANCIA_MM = 0.005

// ¿Es `poly` la misma forma que `ref` (puntos relativos a su primer punto),
// corrida de lugar? Corta en el primer punto que no coincide.
function mismaForma(poly, ref) {
  const x0 = poly[0][0], y0 = poly[0][1]
  for (let i = 1; i < poly.length; i++) {
    if (Math.abs(poly[i][0] - x0 - ref[i * 2]) > TOLERANCIA_MM) return false
    if (Math.abs(poly[i][1] - y0 - ref[i * 2 + 1]) > TOLERANCIA_MM) return false
  }
  return true
}

/**
 * PURO. Devuelve los contornos de la zona segura (mm) para estos cortes.
 * Los recorridos abiertos y las formas degeneradas se saltean.
 * @param {Array<Array<[number,number]>>} cortes - polilíneas en mm
 * @param {number} margenMm - cuánto se achica hacia adentro (> 0)
 * @param {{calculos?:number}} [stats] - si viene, cuenta cuántas veces se achicó de verdad
 * @returns {Array<Array<[number,number]>>}
 */
export function safeZoneCuts(cortes, margenMm, stats = null) {
  const s = Number(margenMm) || 0
  if (!(s > 0) || !Array.isArray(cortes)) return []
  // Formas ya calculadas, agrupadas por cantidad de puntos (descarta rápido las
  // que no pueden ser iguales): [{ ref, rel }], rel = contornos achicados
  // relativos al primer punto del corte.
  const porLargo = new Map()
  const out = []
  for (const poly of cortes) {
    if (!poly || poly.length < 3) continue
    // Un recorrido ABIERTO no es el contorno de nada: no se puede achicar hacia
    // adentro. Mejor no dibujar nada que dibujar una forma inventada.
    const cerrado = Math.hypot(poly[0][0] - poly[poly.length - 1][0],
      poly[0][1] - poly[poly.length - 1][1]) < 0.05
    if (!cerrado) continue
    const x0 = poly[0][0], y0 = poly[0][1]
    let grupo = porLargo.get(poly.length)
    if (!grupo) { grupo = []; porLargo.set(poly.length, grupo) }
    let rel
    for (const g of grupo) { if (mismaForma(poly, g.ref)) { rel = g.rel; break } }
    if (rel === undefined) {
      rel = []
      const cp = poly.map(([x, y]) => ({ X: Math.round((x - x0) * ESCALA), Y: Math.round((y - y0) * ESCALA) }))
      try {
        const { polys } = offsetPolygons([cp], -s, { joinType: 'miter' })
        for (const sol of polys) {
          if (sol && sol.length >= 3) rel.push(sol.map((p) => [p.X / ESCALA, p.Y / ESCALA]))
        }
      } catch {
        /* forma degenerada: la salteamos */
      }
      const ref = new Float64Array(poly.length * 2)
      for (let i = 0; i < poly.length; i++) { ref[i * 2] = poly[i][0] - x0; ref[i * 2 + 1] = poly[i][1] - y0 }
      grupo.push({ ref, rel })
      if (stats) stats.calculos = (stats.calculos || 0) + 1
    }
    for (const sol of rel) out.push(sol.map(([x, y]) => [x + x0, y + y0]))
  }
  return out
}
