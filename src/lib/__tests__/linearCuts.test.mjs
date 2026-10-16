// Corte lineal (guillotina). Lo que pidió Mariano, textual:
//   "yo hago una cuadricula de 2cmx3cm y tiene que poner ese tamaño en toda la
//    hoja, al borde izquierdo y derecho deben estar pegados los cortes y arriba
//    y abajo igual y luego a intervalos del tamaño de la celda, luego si las
//    puntas de cada linea tienen que ser 1 mm por lado mas largas para que
//    siempre se corte"
//
// Corre con: node src/lib/__tests__/linearCuts.test.mjs

import { computeGrid, cellsToLinearCuts } from '../grid.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; } else { fail++; console.log(`  FALLA  ${name}  ${extra}`); }
}
const cerca = (a, b) => Math.abs(a - b) < 0.001;
const PUNTA = 1;

// Su grilla real: 14x15 piezas de 20x30 mm, pegadas.
const cells = [];
for (let r = 0; r < 15; r++) {
  for (let c = 0; c < 14; c++) {
    cells.push({ id: r * 14 + c, x: 22.5 + c * 20, y: 25 + r * 30, w: 20, h: 30 });
  }
}
const minX = 22.5; const maxX = 302.5; const minY = 25; const maxY = 475;

const cortes = cellsToLinearCuts(cells, { overcutMm: PUNTA });
const vert = cortes.filter((p) => cerca(p[0][0], p[1][0]));
const horz = cortes.filter((p) => cerca(p[0][1], p[1][1]));
const vx = [...new Set(vert.map((p) => +p[0][0].toFixed(3)))].sort((a, b) => a - b);
const hy = [...new Set(horz.map((p) => +p[0][1].toFixed(3)))].sort((a, b) => a - b);
console.log(`Grilla 14x15 de 20x30 · bloque x ${minX}..${maxX}  y ${minY}..${maxY}`);
console.log(`Cortes: ${vert.length} verticales en x = ${vx[0]}, ${vx[1]}, … ${vx[vx.length - 1]}`);
console.log(`        ${horz.length} horizontales en y = ${hy[0]}, ${hy[1]}, … ${hy[hy.length - 1]}`);

console.log('\n1) Los cortes del borde van PEGADOS a la celda');
check('corte izquierdo pegado', cerca(vx[0], minX), `${vx[0]} vs ${minX}`);
check('corte derecho pegado', cerca(vx[vx.length - 1], maxX), `${vx[vx.length - 1]} vs ${maxX}`);
check('corte de arriba pegado', cerca(hy[0], minY), `${hy[0]} vs ${minY}`);
check('corte de abajo pegado', cerca(hy[hy.length - 1], maxY), `${hy[hy.length - 1]} vs ${maxY}`);

console.log('2) Cantidad y separación: a intervalos del tamaño de la celda');
check('15 líneas verticales (14 columnas + 1)', vx.length === 15, `son ${vx.length}`);
check('16 líneas horizontales (15 filas + 1)', hy.length === 16, `son ${hy.length}`);
check('todas las verticales separadas 20mm', vx.every((x, i) => i === 0 || cerca(x - vx[i - 1], 20)));
check('todas las horizontales separadas 30mm', hy.every((y, i) => i === 0 || cerca(y - hy[i - 1], 30)));

console.log('3) TODAS las piezas salen de 20x30 exactos (también las del borde)');
let malas = 0;
for (let i = 0; i < vx.length - 1; i++) {
  for (let j = 0; j < hy.length - 1; j++) {
    if (!cerca(vx[i + 1] - vx[i], 20) || !cerca(hy[j + 1] - hy[j], 30)) malas++;
  }
}
check('las 210 piezas miden 20x30', malas === 0, `${malas} piezas con otro tamaño`);
check('hay 210 piezas', (vx.length - 1) * (hy.length - 1) === 210);

console.log('4) Las PUNTAS sobresalen 1mm por lado');
check('las verticales arrancan 1mm arriba del bloque', vert.every((p) => cerca(Math.min(p[0][1], p[1][1]), minY - PUNTA)));
check('las verticales terminan 1mm abajo', vert.every((p) => cerca(Math.max(p[0][1], p[1][1]), maxY + PUNTA)));
check('las horizontales arrancan 1mm a la izquierda', horz.every((p) => cerca(Math.min(p[0][0], p[1][0]), minX - PUNTA)));
check('las horizontales terminan 1mm a la derecha', horz.every((p) => cerca(Math.max(p[0][0], p[1][0]), maxX + PUNTA)));

console.log('5) El diseño de la celda llega justo al corte (sin filo blanco)');
let conFilo = 0;
for (const c of cells) {
  const izq = Math.max(...vx.filter((x) => x <= c.x + 0.001));
  const der = Math.min(...vx.filter((x) => x >= c.x + c.w - 0.001));
  const arr = Math.max(...hy.filter((y) => y <= c.y + 0.001));
  const aba = Math.min(...hy.filter((y) => y >= c.y + c.h - 0.001));
  if (!cerca(izq, c.x) || !cerca(der, c.x + c.w) || !cerca(arr, c.y) || !cerca(aba, c.y + c.h)) conFilo++;
}
check('ninguna celda queda adentro de su corte', conFilo === 0, `${conFilo} celdas`);

console.log('6) Con una grilla hecha por la app (computeGrid)');
const g = computeGrid({ paperW: 325, paperH: 500, cellW: 20, cellH: 30, marginX: 10, marginY: 10, spacingX: 0, spacingY: 0 });
const gc = cellsToLinearCuts(g.cells, { overcutMm: PUNTA });
const gvx = [...new Set(gc.filter((p) => cerca(p[0][0], p[1][0])).map((p) => +p[0][0].toFixed(3)))].sort((a, b) => a - b);
const gMinX = Math.min(...g.cells.map((c) => c.x));
const gMaxX = Math.max(...g.cells.map((c) => c.x + c.w));
check('el corte izquierdo cae en la primera celda', cerca(gvx[0], gMinX), `${gvx[0]} vs ${gMinX}`);
check('el corte derecho cae en la última celda', cerca(gvx[gvx.length - 1], gMaxX));
check('todas las piezas de 20mm de ancho', gvx.every((x, i) => i === 0 || cerca(x - gvx[i - 1], 20)));

console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exit(fail ? 1 : 0);
