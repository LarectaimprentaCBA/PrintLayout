// Resumen de tamaños de celda que muestra el panel de la plantilla.
//   node src/lib/__tests__/cellSizes.test.mjs
import { cellSizeSummary, formatMm } from '../templates.js'

let ok = 0; let fail = 0
function check(nombre, cond, extra = '') {
  if (cond) ok++
  else { fail++; console.log(`  FALLO: ${nombre} ${extra}`) }
}
const cel = (w, h, n) => Array.from({ length: n }, (_, i) => ({ x: i, y: 0, w, h }))

let r = cellSizeSummary({ celdas: cel(90, 55, 12) })
check('grilla pareja: un solo renglón', r.length === 1 && r[0].w === 90 && r[0].h === 55 && r[0].count === 12, JSON.stringify(r))

// Diferencias de centésimas (redondeo del armado) no parten el grupo.
r = cellSizeSummary({ celdas: [{ w: 62.5, h: 40 }, { w: 62.5004, h: 39.9996 }, { w: 62.49, h: 40.02 }] })
check('centésimas de diferencia = la misma medida', r.length === 1 && r[0].count === 3 && r[0].w === 62.5 && r[0].h === 40, JSON.stringify(r))

r = cellSizeSummary({ celdas: [...cel(50, 50, 2), ...cel(100, 70, 5), ...cel(30, 20, 5)] })
check('medidas múltiples: un renglón por medida', r.length === 3)
check('primero la más repetida; a igual cantidad, la más grande', r[0].w === 100 && r[1].w === 30 && r[2].w === 50, JSON.stringify(r))
check('las cantidades suman el total', r.reduce((n, s) => n + s.count, 0) === 12)

r = cellSizeSummary({ celdas: [{ w: 40, h: 60 }, { w: 60, h: 40 }] })
check('vertical y apaisada son medidas distintas', r.length === 2)

r = cellSizeSummary({ pages: [{ celdas: cel(90, 55, 4) }, { celdas: cel(90, 55, 4) }, { celdas: cel(40, 40, 3) }] })
check('varias hojas: junta las de todas', r.length === 2 && r[0].count === 8 && r[1].count === 3, JSON.stringify(r))

check('sin plantilla / sin celdas → vacío', cellSizeSummary(null).length === 0 && cellSizeSummary({}).length === 0 && cellSizeSummary({ celdas: [] }).length === 0)
check('celdas rotas se ignoran', cellSizeSummary({ celdas: [{ w: 0, h: 10 }, { w: 'x', h: 5 }, null, { w: 10, h: 10 }] }).length === 1)

check('formatMm entero', formatMm(90) === '90')
check('formatMm decimal con coma', formatMm(62.5) === '62,5')
check('formatMm redondea a 0,1', formatMm(53.04) === '53' && formatMm(53.06) === '53,1')
check('formatMm basura', formatMm('x') === '—')

console.log(fail === 0 ? `cellSizes: ${ok} OK` : `cellSizes: ${fail} FALLOS, ${ok} OK`)
process.exitCode = fail === 0 ? 0 : 1
