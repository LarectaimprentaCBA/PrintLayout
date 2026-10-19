// Test del generador de perfil ICC.
//
// Verifica SIN imprimir:
//  1. El .icc queda estructuralmente bien (cabecera + tabla de etiquetas).
//  2. Simulando lo que hace el motor de color (sRGB -> PCS Lab D50 -> B2A), el
//     RGB que sale coincide con aplicar la tabla de la calibración directo.
//  3. Ida y vuelta A2B -> B2A devuelve el mismo valor.
//
// Corre con: node src/lib/colorCalibration/__tests__/icc.test.mjs
// Usa la calibración real del disco si está; si no, uno sintética.

import fs from 'node:fs';
import { Lut3 } from '../colorMath.js';
import { Levels } from '../layout.js';
import {
  buildIccProfile, srgbToLabD50, srgbToXyzD50, labToPcs16, pcs16ToLab, nombreArchivoPerfil,
} from '../icc.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FALLA ${name}  ${extra}`); }
}

// ── calibración de entrada ──────────────────────────────────────────────────
const CAL_PATH = 'C:/Users/4/AppData/Roaming/PrintLayout/color-calibrations.json';
let cal = null;
try {
  const j = JSON.parse(fs.readFileSync(CAL_PATH, 'utf8'));
  cal = (j.calibrations || []).find((c) => Array.isArray(c.lut) && c.lut.length > 0) || null;
} catch { /* sin calibración en disco */ }
if (cal) {
  console.log(`Calibración real: ${cal.id}  (LUT ${cal.lutSize}³)`);
} else {
  // Sintética: corrección suave (saca rojo, sube verde) sólo para poder testear.
  const S = 17;
  const l = new Lut3(S);
  for (let r = 0; r < S; r++) {
    for (let g = 0; g < S; g++) {
      for (let b = 0; b < S; b++) {
        const R = (255 * r) / (S - 1); const G = (255 * g) / (S - 1); const B = (255 * b) / (S - 1);
        l.set(r, g, b,
          Math.max(0, Math.min(255, R * 0.92)),
          Math.max(0, Math.min(255, G * 1.05)),
          Math.max(0, Math.min(255, B * 0.97)));
      }
    }
  }
  cal = { lut: Array.from(l.V), lutSize: S, correctPrinter: { ip: '192.168.100.198' } };
  console.log('Sin calibración en disco: uso una sintética.');
}

const lut = new Lut3(cal.lutSize);
lut.V.set(cal.lut);
const aplicarTabla = (r, g, b) => {
  const o = new Float64Array(3);
  lut.apply(r, g, b, o);
  return [o[0], o[1], o[2]];
};

// ── generar ─────────────────────────────────────────────────────────────────
const PCS = process.env.ICC_PCS || 'XYZ';
const GRID_B2A = 33;
const t0 = Date.now();
const icc = buildIccProfile(cal, {
  descripcion: 'PrintLayout test', pcs: PCS, gridB2A: GRID_B2A, fecha: new Date(Date.UTC(2026, 8, 23)),
});
console.log(`\nPerfil generado: ${(icc.length / 1024).toFixed(0)} KB en ${Date.now() - t0} ms`);
console.log(`Nombre sugerido: ${nombreArchivoPerfil(cal, new Date(Date.UTC(2026, 8, 23)))}`);

// ── 1) estructura ───────────────────────────────────────────────────────────
console.log('\n1) Estructura del archivo');
const dv = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
const sigAt = (o) => String.fromCharCode(icc[o], icc[o + 1], icc[o + 2], icc[o + 3]);
check('tamaño declarado == tamaño real', dv.getUint32(0) === icc.length, `${dv.getUint32(0)} vs ${icc.length}`);
check("firma 'acsp'", sigAt(36) === 'acsp');
check("clase 'prtr'", sigAt(12) === 'prtr');
check("espacio de datos 'RGB '", sigAt(16) === 'RGB ');
check(`PCS '${PCS}'`, sigAt(20).trim() === PCS);
check('versión 2.x', (dv.getUint32(8) >>> 24) === 2);
check('múltiplo de 4', icc.length % 4 === 0);

const nTags = dv.getUint32(128);
const tags = new Map();
for (let i = 0; i < nTags; i++) {
  const o = 132 + i * 12;
  tags.set(sigAt(o), { offset: dv.getUint32(o + 4), size: dv.getUint32(o + 8) });
}
console.log(`     etiquetas: ${[...tags.keys()].join(', ')}`);
for (const t of ['desc', 'cprt', 'wtpt', 'A2B0', 'A2B1', 'A2B2', 'B2A0', 'B2A1', 'B2A2', 'gamt']) {
  check(`está ${t}`, tags.has(t));
}
let dentro = true;
for (const [, t] of tags) if (t.offset + t.size > icc.length || t.offset % 4 !== 0) dentro = false;
check('todas las etiquetas caen adentro y alineadas a 4', dentro);
check("A2B0 es 'mft2'", sigAt(tags.get('A2B0').offset) === 'mft2');
check("B2A0 es 'mft2'", sigAt(tags.get('B2A0').offset) === 'mft2');
check('A2B0/1/2 comparten datos', tags.get('A2B0').offset === tags.get('A2B2').offset);

// ── leer un CLUT del perfil, como haría el motor de color ───────────────────
function leerLut16(off) {
  const inCh = icc[off + 8];
  const outCh = icc[off + 9];
  const grid = icc[off + 10];
  const matrix = [];
  for (let i = 0; i < 9; i++) matrix.push(dv.getInt32(off + 12 + i * 4) / 65536);
  const nIn = dv.getUint16(off + 48);
  const nOut = dv.getUint16(off + 50);
  let p = off + 52;
  const inCurves = [];
  for (let c = 0; c < inCh; c++) {
    const cur = new Uint16Array(nIn);
    for (let i = 0; i < nIn; i++) cur[i] = dv.getUint16(p + i * 2);
    p += nIn * 2;
    inCurves.push(cur);
  }
  const n = grid ** inCh * outCh;
  const clut = new Uint16Array(n);
  for (let i = 0; i < n; i++) clut[i] = dv.getUint16(p + i * 2);
  p += n * 2;
  const outCurves = [];
  for (let c = 0; c < outCh; c++) {
    const cur = new Uint16Array(nOut);
    for (let i = 0; i < nOut; i++) cur[i] = dv.getUint16(p + i * 2);
    p += nOut * 2;
    outCurves.push(cur);
  }
  return {
    inCh, outCh, grid, clut, nIn, nOut, matrix, inCurves, outCurves,
  };
}

// Curva 1D del perfil, con interpolación lineal (como hace el motor). u en 0..1.
function aplicarCurva(cur, u) {
  const x = Math.max(0, Math.min(1, u)) * (cur.length - 1);
  const i = Math.min(cur.length - 2, Math.floor(x));
  const t = x - i;
  return (cur[i] + (cur[i + 1] - cur[i]) * t) / 65535;
}
// Interpolación trilineal sobre el CLUT, igual que un CMM. Entradas 0..65535.
function interpClut(t, e0, e1, e2) {
  const g = t.grid; const oc = t.outCh;
  const f = [e0, e1, e2].map((e) => (e / 65535) * (g - 1));
  const k = f.map((v) => Math.max(0, Math.min(g - 2, Math.floor(v))));
  const d = f.map((v, i) => v - k[i]);
  const at = (i, j, l, c) => t.clut[((i * g + j) * g + l) * oc + c];
  const out = [];
  for (let c = 0; c < oc; c++) {
    const c00 = at(k[0], k[1], k[2], c) + (at(k[0] + 1, k[1], k[2], c) - at(k[0], k[1], k[2], c)) * d[0];
    const c10 = at(k[0], k[1] + 1, k[2], c) + (at(k[0] + 1, k[1] + 1, k[2], c) - at(k[0], k[1] + 1, k[2], c)) * d[0];
    const c01 = at(k[0], k[1], k[2] + 1, c) + (at(k[0] + 1, k[1], k[2] + 1, c) - at(k[0], k[1], k[2] + 1, c)) * d[0];
    const c11 = at(k[0], k[1] + 1, k[2] + 1, c) + (at(k[0] + 1, k[1] + 1, k[2] + 1, c) - at(k[0], k[1] + 1, k[2] + 1, c)) * d[0];
    const a0 = c00 + (c10 - c00) * d[1];
    const a1 = c01 + (c11 - c01) * d[1];
    out.push(a0 + (a1 - a0) * d[2]);
  }
  return out;
}
const B2A = leerLut16(tags.get('B2A0').offset);
const A2B = leerLut16(tags.get('A2B0').offset);
check(`B2A es ${B2A.grid}³ de 3->3`, B2A.inCh === 3 && B2A.outCh === 3);
check(`A2B es ${A2B.grid}³ de 3->3`, A2B.inCh === 3 && A2B.outCh === 3);

// Lo que haría el motor de color con el perfil puesto.
//  - PCS Lab: sRGB -> Lab D50 -> (codificar) -> CLUT
//  - PCS XYZ: sRGB -> XYZ D50 -> MATRIZ -> curvas de entrada -> CLUT
// Desde el PCS ya codificado (lo que recibe B2A) hasta el dispositivo.
function b2aDesdePcs(p0, p1, p2) {
  if (PCS === 'XYZ') {
    // CONVENCIÓN VERIFICADA contra el motor de color de Windows (mscms): para
    // la matriz, el PCS de 16 bits se normaliza dividiendo por 65535 (no por
    // 32768, que sería el valor XYZ real del u1Fixed15). Por eso la matriz del
    // perfil va multiplicada por 2. Con la otra convención el color sale
    // oscurísimo: medido, 136 de error sobre 255.
    // Ver src/lib/colorCalibration/__tests__/iccWindows.test.mjs
    const xyz = [p0 / 65535, p1 / 65535, p2 / 65535];
    const M = B2A.matrix;
    const lin = [
      M[0] * xyz[0] + M[1] * xyz[1] + M[2] * xyz[2],
      M[3] * xyz[0] + M[4] * xyz[1] + M[5] * xyz[2],
      M[6] * xyz[0] + M[7] * xyz[1] + M[8] * xyz[2],
    ];
    const idx = lin.map((u, i) => aplicarCurva(B2A.inCurves[i], u) * 65535);
    const o = interpClut(B2A, idx[0], idx[1], idx[2]);
    return o.map((v) => (v / 65535) * 255);
  }
  const o = interpClut(B2A, p0, p1, p2);
  return o.map((v) => (v / 65535) * 255);
}

function porElPerfil(r, g, b) {
  if (PCS === 'XYZ') {
    const xyz = srgbToXyzD50(r, g, b); // lo que entrega el perfil de origen
    return b2aDesdePcs(xyz[0] * 32768, xyz[1] * 32768, xyz[2] * 32768);
  }
  const lab = srgbToLabD50(r, g, b);
  const p = labToPcs16(lab[0], lab[1], lab[2]);
  return b2aDesdePcs(p[0], p[1], p[2]);
}

// ── 2) el perfil reproduce la tabla ─────────────────────────────────────────
console.log('\n2) El perfil manda lo mismo que la tabla (los 343 colores de la carta)');
let peor = 0; let peorCaso = null; let suma = 0; let n = 0;
for (const R of Levels) {
  for (const G of Levels) {
    for (const B of Levels) {
      const esperado = aplicarTabla(R, G, B);
      const obtenido = porElPerfil(R, G, B);
      const d = Math.max(...[0, 1, 2].map((i) => Math.abs(esperado[i] - obtenido[i])));
      suma += d; n++;
      if (d > peor) { peor = d; peorCaso = { in: [R, G, B], esperado, obtenido }; }
    }
  }
}
console.log(`     diferencia máx ${peor.toFixed(2)} / 255   promedio ${(suma / n).toFixed(3)}`);
if (peorCaso) {
  console.log(`     peor: rgb(${peorCaso.in.join(',')}) esperado [${peorCaso.esperado.map((v) => v.toFixed(1))}] obtenido [${peorCaso.obtenido.map((v) => v.toFixed(1))}]`);
}
check('diferencia máxima <= 2 sobre 255 (los 343 de la carta)', peor <= 2, `peor ${peor.toFixed(2)}`);

// barrido denso, para que no se escape nada entre los nodos
let peorD = 0;
for (let i = 0; i <= 12; i++) {
  for (let j = 0; j <= 12; j++) {
    for (let k = 0; k <= 12; k++) {
      const R = (i / 12) * 255; const G = (j / 12) * 255; const B = (k / 12) * 255;
      const e = aplicarTabla(R, G, B); const o = porElPerfil(R, G, B);
      peorD = Math.max(peorD, ...[0, 1, 2].map((c) => Math.abs(e[c] - o[c])));
    }
  }
}
console.log(`     barrido denso 13³: diferencia máx ${peorD.toFixed(2)} / 255`);
check('barrido denso <= 2 sobre 255', peorD <= 2, `peor ${peorD.toFixed(2)}`);

// ── 3) ida y vuelta A2B -> B2A ──────────────────────────────────────────────
console.log('\n3) Ida y vuelta del perfil (A2B luego B2A)');
// OJO: se prueba sobre valores de dispositivo ALCANZABLES, o sea d = L(c). Un
// valor que la corrección no puede producir (porque recorta) no tiene vuelta
// posible, y exigirlo sería pedirle al perfil algo que no existe.
let peorRT = 0;
let peorRTcaso = null;
let nRT = 0;
let fueraRT = 0;
const o3 = new Float64Array(3);
for (const R of Levels) {
  for (const G of Levels) {
    for (const B of Levels) {
      lut.apply(R, G, B, o3);
      const d = [o3[0], o3[1], o3[2]];
      if (d.some((v) => v <= 0.5 || v >= 254.5)) continue; // recortado: sin vuelta
      nRT++;
      let pcs = interpClut(A2B, (d[0] / 255) * 65535, (d[1] / 255) * 65535, (d[2] / 255) * 65535);
      // curvas de SALIDA del A2B (en XYZ guardan la potencia inversa)
      if (A2B.nOut > 2) pcs = pcs.map((v, i) => aplicarCurva(A2B.outCurves[i], v / 65535) * 65535);
      const dev = b2aDesdePcs(pcs[0], pcs[1], pcs[2]);
      const e = Math.max(...[0, 1, 2].map((i) => Math.abs(d[i] - dev[i])));
      if (e > 2) fueraRT++;
      if (e > peorRT) { peorRT = e; peorRTcaso = [R, G, B]; }
    }
  }
}
console.log(`     ${nRT} valores alcanzables · diferencia máx ${peorRT.toFixed(2)} / 255${peorRTcaso ? ` (peor desde rgb(${peorRTcaso}))` : ''}`);
console.log(`     ${fueraRT} de ${nRT} pasan de 2`);
// El A2B NO puede cerrar exacto en TODOS los colores: donde la tabla de la
// calibración se DOBLA (dos colores distintos terminan en el mismo valor
// enviado) no existe inversa, y los nodos vecinos del CLUT caen en ramas
// distintas. Con la calibración real de la .198 eso pasa en los verdes — la
// misma zona donde la corrección llega al tope. Agrandar la rejilla no lo
// arregla (probado 17/25/33/41/49/65). Lo que SÍ tiene que ser exacto es el
// camino de IMPRESIÓN (B2A), y eso lo verifica el bloque 2.
check('la gran mayoría cierra (>= 90% con diferencia <= 2)', fueraRT <= nRT * 0.1,
  `${fueraRT} de ${nRT} pasan de 2`);
if (peorRT > 2) {
  console.log('     NOTA: los que no cierran son donde la tabla se dobla (no tiene inversa).');
  console.log('           No afecta la impresión desde Corel, que usa el camino B2A.');
}

// ── 4) codificación Lab v2 ──────────────────────────────────────────────────
console.log('\n4) Codificación Lab de ICC v2');
check('L=100 -> 0xFF00', labToPcs16(100, 0, 0)[0] === 0xff00);
check('a=0 -> 0x8000 aprox', Math.abs(labToPcs16(0, 0, 0)[1] - 0x8000) <= 130);
check('a=-128 -> 0', labToPcs16(0, -128, 0)[1] === 0);
const rt = pcs16ToLab(...labToPcs16(55.5, -33.3, 44.4));
check('Lab ida y vuelta', Math.max(Math.abs(rt[0] - 55.5), Math.abs(rt[1] + 33.3), Math.abs(rt[2] - 44.4)) < 0.01);

console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exit(fail ? 1 : 0);
