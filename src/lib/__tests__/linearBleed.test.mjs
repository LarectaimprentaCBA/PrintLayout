// Corte lineal: el diseño tiene que llegar EXACTO hasta donde corta la cuchilla.
//
// El corte del perímetro va `overcutMm` hacia afuera para que la fila/columna
// del borde se corte entera aunque la impresión venga movida. Sin sangrado,
// esas piezas salían con un filo BLANCO entre el dibujo y el corte.
//
// Corre con: node src/lib/__tests__/linearBleed.test.mjs

import { computeGrid, cellsToLinearCuts, blockBounds, edgeBleedForCell } from '../grid.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; } else { fail++; console.log(`  FALLA  ${name}  ${extra}`); }
}
const cerca = (a, b) => Math.abs(a - b) < 0.001;

// Misma grilla que la plantilla real de Mariano: 14x15 piezas de 20x30, pegadas.
const OVERCUT = 2;
const cells = [];
for (let r = 0; r < 15; r++) {
  for (let c = 0; c < 14; c++) {
    cells.push({
      id: r * 14 + c, x: 22.5 + c * 20, y: 25 + r * 30, w: 20, h: 30,
    });
  }
}
const bounds = blockBounds(cells);
console.log(`Bloque: x ${bounds.minX}..${bounds.maxX}  ·  y ${bounds.minY}..${bounds.maxY}  (${cells.length} celdas)`);

const cortes = cellsToLinearCuts(cells, { overcutMm: OVERCUT });
const vert = [...new Set(cortes
  .filter((p) => cerca(p[0][0], p[1][0]))
  .map((p) => +p[0][0].toFixed(3)))].sort((a, b) => a - b);
const horz = [...new Set(cortes
  .filter((p) => cerca(p[0][1], p[1][1]))
  .map((p) => +p[0][1].toFixed(3)))].sort((a, b) => a - b);
console.log(`Cortes: ${vert.length} verticales · ${horz.length} horizontales`);
console.log(`  verticales   x = ${vert[0]}, ${vert[1]}, … ${vert[vert.length - 1]}`);
console.log(`  horizontales y = ${horz[0]}, ${horz[1]}, … ${horz[horz.length - 1]}`);

// ── 1) el perímetro del corte sale hacia afuera (lo que Mariano quiere) ─────
console.log('\n1) El corte del perímetro sobresale (para que corte entero)');
check('corte izquierdo 2mm afuera', cerca(vert[0], bounds.minX - OVERCUT), `${vert[0]} vs ${bounds.minX - OVERCUT}`);
check('corte derecho 2mm afuera', cerca(vert[vert.length - 1], bounds.maxX + OVERCUT));
check('corte de arriba 2mm afuera', cerca(horz[0], bounds.minY - OVERCUT));
check('corte de abajo 2mm afuera', cerca(horz[horz.length - 1], bounds.maxY + OVERCUT));
check('los cortes del medio caen exactos en la celda',
  vert.slice(1, -1).every((x) => cells.some((c) => cerca(c.x, x))));

// ── 2) el dibujo llega exacto hasta el corte ────────────────────────────────
console.log('2) El dibujo de cada pieza llega hasta su corte (sin filo blanco)');
let sinLlegar = 0;
let peorHueco = 0;
let conSangrado = 0;
for (const c of cells) {
  const ex = edgeBleedForCell(c, bounds, OVERCUT);
  if (ex.l || ex.r || ex.t || ex.b) conSangrado++;
  // rectángulo donde se dibuja la imagen, ya con sangrado
  const dx0 = c.x - ex.l;
  const dx1 = c.x + c.w + ex.r;
  const dy0 = c.y - ex.t;
  const dy1 = c.y + c.h + ex.b;
  // el corte que limita cada lado de esta pieza
  const izq = Math.max(...vert.filter((x) => x <= c.x + 0.001));
  const der = Math.min(...vert.filter((x) => x >= c.x + c.w - 0.001));
  const arr = Math.max(...horz.filter((y) => y <= c.y + 0.001));
  const aba = Math.min(...horz.filter((y) => y >= c.y + c.h - 0.001));
  const huecos = [izq - dx0, dx1 - der, arr - dy0, dy1 - aba].map((v) => -v);
  // hueco > 0 = queda papel BLANCO entre el dibujo y el corte
  const peor = Math.max(...huecos);
  if (peor > 0.001) { sinLlegar++; peorHueco = Math.max(peorHueco, peor); }
}
console.log(`   celdas con sangrado: ${conSangrado} de ${cells.length} (solo las del borde)`);
check('ninguna pieza queda con filo blanco', sinLlegar === 0,
  `${sinLlegar} piezas, hueco peor ${peorHueco.toFixed(2)}mm`);

// las del medio NO se tocan
const medio = cells.find((c) => c.x > bounds.minX && c.x + c.w < bounds.maxX
  && c.y > bounds.minY && c.y + c.h < bounds.maxY);
const exMedio = edgeBleedForCell(medio, bounds, OVERCUT);
check('las piezas del medio no se estiran',
  exMedio.l === 0 && exMedio.r === 0 && exMedio.t === 0 && exMedio.b === 0);

// una esquina se estira por DOS lados
const esquina = cells.find((c) => cerca(c.x, bounds.minX) && cerca(c.y, bounds.minY));
const exEsq = edgeBleedForCell(esquina, bounds, OVERCUT);
check('la esquina se estira por sus dos lados de afuera',
  exEsq.l === OVERCUT && exEsq.t === OVERCUT && exEsq.r === 0 && exEsq.b === 0);

// ── 3) sin corte lineal, nada cambia ────────────────────────────────────────
console.log('3) Sin corte lineal no se estira nada');
const ex0 = edgeBleedForCell(esquina, bounds, 0);
check('overcut 0 => sin sangrado', ex0.l === 0 && ex0.r === 0 && ex0.t === 0 && ex0.b === 0);
check('sin bloque => sin sangrado', edgeBleedForCell(esquina, null, 2).l === 0);

// ── 4) con una grilla generada por la app ───────────────────────────────────
console.log('4) Con una grilla real de computeGrid');
const g = computeGrid({
  paperW: 325, paperH: 500, cellW: 50, cellH: 40, marginX: 10, marginY: 10, spacingX: 0, spacingY: 0,
});
const gb = blockBounds(g.cells);
const gc = cellsToLinearCuts(g.cells, { overcutMm: OVERCUT });
const gv = [...new Set(gc.filter((p) => cerca(p[0][0], p[1][0])).map((p) => +p[0][0].toFixed(3)))].sort((a, b) => a - b);
check('el corte izquierdo sale 2mm del bloque', cerca(gv[0], gb.minX - OVERCUT));
const gEsq = g.cells.find((c) => cerca(c.x, gb.minX) && cerca(c.y, gb.minY));
const gEx = edgeBleedForCell(gEsq, gb, OVERCUT);
check('la esquina llega al corte', cerca(gEsq.x - gEx.l, gv[0]), `${gEsq.x - gEx.l} vs ${gv[0]}`);

console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exit(fail ? 1 : 0);
