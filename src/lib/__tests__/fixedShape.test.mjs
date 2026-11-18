// Corte de FORMA FIJA por imagen (rectángulo / círculo / óvalo) dentro de una
// hoja que corta por contorno.   node src/lib/__tests__/fixedShape.test.mjs
import { fixedShapeCortes, imageBoxInCell, isFixedShape } from '../contour/fixedShape.js'
import { contourCutsByAssignments } from '../stickerContour.js'
import { cellShapePoly } from '../grid.js'

let ok = 0; let fail = 0
function check(nombre, cond, extra = '') {
  if (cond) ok++
  else { fail++; console.log(`  FALLO: ${nombre} ${extra}`) }
}
const near = (a, b, eps = 0.002) => Math.abs(a - b) <= eps
function bbox(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
}
function area(poly) {
  let a = 0
  for (let i = 0; i < poly.length - 1; i++) a += poly[i][0] * poly[i + 1][1] - poly[i + 1][0] * poly[i][1]
  return Math.abs(a) / 2
}
const cerrada = (p) => p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]

// Celda 60×40 en (10,20); imagen 1000×1000 → en "Enteras" queda 40×40 centrada.
const cell = { x: 10, y: 20, w: 60, h: 40 }

check('isFixedShape', isFixedShape('rect') && isFixedShape('circle') && isFixedShape('oval') && !isFixedShape('contour') && !isFixedShape(undefined))

// --- dónde se imprime la imagen ---
let b = imageBoxInCell(cell, 1000, 1000)
check('Enteras: cuadrada centrada', near(b.x, 20) && near(b.y, 20) && near(b.w, 40) && near(b.h, 40), JSON.stringify(b))
b = imageBoxInCell(cell, 2000, 1000)
check('Enteras: apaisada llena el ancho', near(b.x, 10) && near(b.w, 60) && near(b.h, 30) && near(b.y, 25), JSON.stringify(b))
b = imageBoxInCell(cell, 1000, 1000, { fit: 'cover' })
check('Rellenar: ocupa toda la celda', near(b.x, 10) && near(b.y, 20) && near(b.w, 60) && near(b.h, 40))
b = imageBoxInCell(cell, 1000, 1000, { borderMm: 2 })
check('borde blanco achica la caja', near(b.w, 36) && near(b.h, 36) && near(b.x, 22) && near(b.y, 22), JSON.stringify(b))
b = imageBoxInCell(cell, 1000, 2000, { rotated: true })
check('girada 90°: usa el ancho/alto cambiados', near(b.w, 60) && near(b.h, 30), JSON.stringify(b))
b = imageBoxInCell(cell, 0, 0)
check('sin medidas de imagen → la celda', near(b.w, 60) && near(b.h, 40))

// --- rectángulo ---
let c = fixedShapeCortes(cell, 1000, 1000, { shape: 'rect' })
check('rect: una sola línea cerrada de 5 puntos', c.length === 1 && c[0].length === 5 && cerrada(c[0]))
let bb = bbox(c[0])
check('rect: calza con la imagen', near(bb.x0, 20) && near(bb.y0, 20) && near(bb.w, 40) && near(bb.h, 40))
bb = bbox(fixedShapeCortes(cell, 1000, 1000, { shape: 'rect', bleedMm: 1.5 })[0])
check('rect +1.5: 1.5 mm por afuera', near(bb.x0, 18.5) && near(bb.w, 43) && near(bb.h, 43))
bb = bbox(fixedShapeCortes(cell, 1000, 1000, { shape: 'rect', bleedMm: -1 })[0])
check('rect −1: 1 mm por adentro', near(bb.x0, 21) && near(bb.w, 38) && near(bb.h, 38))
check('rect achicado hasta desaparecer → sin corte (no línea invertida)', fixedShapeCortes(cell, 1000, 1000, { shape: 'rect', bleedMm: -20 }).length === 0)
c = fixedShapeCortes(cell, 1000, 1000, { shape: 'rect', cornerRadiusMm: 5 })
bb = bbox(c[0])
check('rect redondeado: misma caja', near(bb.x0, 20) && near(bb.w, 40) && near(bb.h, 40) && cerrada(c[0]))
check('rect redondeado: le faltan las 4 esquinas', near(area(c[0]), 40 * 40 - (4 - Math.PI) * 25, 0.5), String(area(c[0])))
check('rect redondeado: ningún punto en la esquina viva', c[0].every(([x, y]) => !(near(x, 20) && near(y, 20))))

// --- círculo ---
c = fixedShapeCortes(cell, 2000, 1000, { shape: 'circle' }) // imagen impresa 60×30
bb = bbox(c[0])
check('círculo: redondo de verdad aunque la imagen sea apaisada', near(bb.w, 30, 0.02) && near(bb.h, 30, 0.02))
check('círculo: centrado en la imagen', near((bb.x0 + bb.x1) / 2, 40, 0.02) && near((bb.y0 + bb.y1) / 2, 40, 0.02))
check('círculo: cerrado exacto, sin punto repetido al final', cerrada(c[0]) && c[0].length === 97)
check('círculo: todos los puntos a radio 15', c[0].every(([x, y]) => near(Math.hypot(x - 40, y - 40), 15, 0.001)))
bb = bbox(fixedShapeCortes(cell, 2000, 1000, { shape: 'circle', bleedMm: 2 })[0])
check('círculo +2: diámetro 34', near(bb.w, 34, 0.02))

// --- óvalo ---
c = fixedShapeCortes(cell, 2000, 1000, { shape: 'oval' })
bb = bbox(c[0])
check('óvalo: toca los 4 lados de la imagen', near(bb.w, 60, 0.02) && near(bb.h, 30, 0.02) && near(bb.x0, 10, 0.02) && near(bb.y0, 25, 0.02))
check('óvalo: área de elipse', near(area(c[0]), Math.PI * 30 * 15, 2), String(area(c[0])))
check('óvalo en imagen cuadrada = círculo', (() => { const o = bbox(fixedShapeCortes(cell, 500, 500, { shape: 'oval' })[0]); return near(o.w, 40, 0.02) && near(o.h, 40, 0.02) })())

// --- "Limitar a la forma" del casillero ---
const clip = cellShapePoly(cell, { shape: 'circle' }) // círculo de 40 en la celda
c = fixedShapeCortes(cell, 1000, 1000, { shape: 'rect', bleedMm: 5, clipPoly: clip })
bb = bbox(c[0])
check('recortado contra el casillero: no se sale', c.length === 1 && bb.w <= 40.01 && bb.h <= 40.01 && cerrada(c[0]), JSON.stringify(bb))
check('forma desconocida → nada', fixedShapeCortes(cell, 1000, 1000, { shape: 'contour' }).length === 0)

// --- integrado en el cálculo de la hoja ---
const cells = [{ x: 0, y: 0, w: 50, h: 50 }, { x: 60, y: 0, w: 50, h: 50 }, { x: 120, y: 0, w: 50, h: 50 }]
const imageMap = new Map([
  ['fija', { dataUrl: 'data:x', width: 800, height: 400 }],
  ['traz', { dataUrl: 'data:y', width: 100, height: 100 }],
])
// "traz" ya está trazada en el caché: un cuadrado que ocupa media imagen.
const sc = { maskedW: 100, maskedH: 100, contours: [{ isOuter: true, area: 1, points: [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]] }] }
const cache = new Map([['traz', { sc, traceKey: 'potrace:32:128:2:1:0.2:B' }]])
const params = { outerBorder: true, smoothMm: 0, bleedMm: 0 }

let stats = { missing: 0 }
let cortes = await contourCutsByAssignments(['fija', 'traz', 'fija'], cells, imageMap, {
  params, paramsByImage: { fija: { shape: 'rect', shapeBleedMm: -1 } }, cache, cacheOnly: true, stats,
})
check('hoja mixta: 3 cortes (2 fijos + 1 contorno)', cortes.length === 3, String(cortes.length))
bb = bbox(cortes[0])
check('fija en celda 1: rectángulo 50×25 menos 1 mm por lado', near(bb.w, 48) && near(bb.h, 23) && near(bb.x0, 1) && near(bb.y0, 13.5), JSON.stringify(bb))
bb = bbox(cortes[2])
check('fija en celda 3: el mismo, trasladado', near(bb.w, 48) && near(bb.h, 23) && near(bb.x0, 121), JSON.stringify(bb))
bb = bbox(cortes[1])
check('la de contorno no cambia', near(bb.x0, 72.5, 0.05) && near(bb.w, 25, 0.05), JSON.stringify(bb))
check('nada faltante con el caché caliente', stats.missing === 0)

// Caché frío: la fija igual corta (no necesita trazado) y avisa que falta la otra.
stats = { missing: 0 }
cortes = await contourCutsByAssignments(['fija', 'traz'], cells, imageMap, {
  params, paramsByImage: { fija: { shape: 'circle' } }, cache: new Map(), cacheOnly: true, stats,
})
check('caché frío: la fija corta igual', cortes.length === 1 && near(bbox(cortes[0]).w, 25, 0.02))
check('caché frío: avisa que falta trazar 1', stats.missing === 1)

// Rellenar + borde blanco por imagen.
imageMap.set('fija', { dataUrl: 'data:x', width: 800, height: 400, fitOverride: 'cover', frame: { whiteBorderMm: 3 } })
cortes = await contourCutsByAssignments(['fija'], cells, imageMap, { params, paramsByImage: { fija: { shape: 'rect' } }, cache, cacheOnly: true })
bb = bbox(cortes[0])
check('Rellenar + borde blanco 3: rectángulo 44×44', near(bb.w, 44) && near(bb.h, 44) && near(bb.x0, 3), JSON.stringify(bb))

// Encuadre de la hoja (sin override en la imagen).
imageMap.set('fija', { dataUrl: 'data:x', width: 800, height: 400 })
cortes = await contourCutsByAssignments(['fija'], cells, imageMap, { params: { ...params, fitMode: 'cover' }, paramsByImage: { fija: { shape: 'rect' } }, cache, cacheOnly: true })
check('hoja en Rellenar: el rectángulo es la celda', near(bbox(cortes[0]).w, 50) && near(bbox(cortes[0]).h, 50))

// Sin forma fija todo sigue como siempre (un override común NO se toma por forma).
cortes = await contourCutsByAssignments(['traz'], cells, imageMap, { params, paramsByImage: { traz: { bleedMm: 0 } }, cache, cacheOnly: true })
check('override sin forma = contorno de siempre', cortes.length === 1 && near(bbox(cortes[0]).w, 25, 0.05))

console.log(fail === 0 ? `fixedShape: ${ok} OK` : `fixedShape: ${fail} FALLOS, ${ok} OK`)
process.exitCode = fail === 0 ? 0 : 1
