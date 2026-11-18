// El blanco se queda blanco: preservarBlanco() (main CJS + gemela ESM).
//   node src/lib/colorCalibration/__tests__/blanco.test.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { preservarBlanco, BLANCO_DESDE } from '../blanco.js';
import { Lut3 } from '../colorMath.js';

const require = createRequire(import.meta.url);
const main = require('../../../../electron/color/lut.cjs');

let ok = 0, bad = 0;
function check(nombre, cond, extra = '') {
  if (cond) { ok++; } else { bad++; console.log('  FALLÓ:', nombre, extra); }
}

// LUT sintética que ensucia el blanco como una calibración real (papel de
// referencia más oscuro): identidad oscurecida + un tinte.
function lutSucia(S) {
  const l = new Lut3(S);
  for (let r = 0; r < S; r++) for (let g = 0; g < S; g++) for (let b = 0; b < S; b++) {
    const R = l.nodo(r), G = l.nodo(g), B = l.nodo(b);
    l.set(r, g, b, Math.max(0, R * 0.96 - 2), Math.max(0, G * 0.95 - 1), Math.max(0, B * 0.99));
  }
  return l;
}

const casos = [{ nombre: 'sintética 17', S: 17, V: lutSucia(17).V }, { nombre: 'sintética 5', S: 5, V: lutSucia(5).V }];
// Calibraciones reales de esta PC, si las hay.
try {
  const f = path.join(process.env.APPDATA || '', 'printlayout', 'color-calibrations.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const c of j.calibrations || []) {
    if (Array.isArray(c.lut) && c.lut.length === c.lutSize ** 3 * 3) {
      casos.push({ nombre: `real ${c.correctPrinter?.ip} ${c.paperName || ''}`.trim(), S: c.lutSize, V: c.lut });
    }
  }
} catch (_) { /* sin calibraciones reales: alcanza con las sintéticas */ }

const o = new Float64Array(3);
const p = new Float64Array(3);
for (const { nombre, S, V } of casos) {
  const out = preservarBlanco(V, S);
  const outMain = main.preservarBlanco(V, S);
  const n = S * S * S * 3;

  // 1) gemelas idénticas
  let dif = 0;
  for (let i = 0; i < n; i++) dif = Math.max(dif, Math.abs(out[i] - outMain[i]));
  check(`${nombre}: main y renderer dan idéntico`, dif === 0, 'dif=' + dif);

  // 2) no toca la entrada
  check(`${nombre}: no modifica la tabla original`, out !== V);

  const lim = new Lut3(S); lim.V.set(out);
  const cru = new Lut3(S); cru.V.set(V);

  // 3) blanco puro → blanco puro
  lim.apply(255, 255, 255, o);
  check(`${nombre}: blanco sale 255,255,255`, o[0] === 255 && o[1] === 255 && o[2] === 255, Array.from(o).join(','));

  // 4) de 212.5 para abajo no cambia NADA (nodo por nodo)
  const paso = 255 / (S - 1);
  let tocados = 0, intactosMal = 0;
  for (let r = 0; r < S; r++) for (let g = 0; g < S; g++) for (let b = 0; b < S; b++) {
    const base = ((r * S + g) * S + b) * 3;
    const cambio = out[base] !== V[base] || out[base + 1] !== V[base + 1] || out[base + 2] !== V[base + 2];
    if (Math.min(r, g, b) * paso <= BLANCO_DESDE) { if (cambio) intactosMal++; } else if (cambio) tocados++;
  }
  check(`${nombre}: colores con algún canal <= 212.5 quedan exactos`, intactosMal === 0, 'cambiaron ' + intactosMal);

  // 5) colores puros / saturados intactos
  for (const [r, g, b] of [[255, 0, 0], [255, 255, 0], [0, 0, 0], [0, 255, 255], [128, 128, 128], [255, 120, 255]]) {
    lim.apply(r, g, b, o); cru.apply(r, g, b, p);
    check(`${nombre}: ${r},${g},${b} sin cambios`, o[0] === p[0] && o[1] === p[1] && o[2] === p[2]);
  }

  // 6) cerca del blanco: nunca más oscuro que antes, y sin escalón (grises 213→255
  //    no decrecen y ningún paso de 1 nivel salta una barbaridad)
  // (una calibración real puede traer algún retroceso mínimo propio, por ruido
  //  del escaneo: lo que se exige es no empeorarlo)
  let nuncaMasOscuro = true, retroceso = 0, retrocesoAntes = 0, saltoMax = 0;
  let prev = null, prevCru = null;
  for (let v = 200; v <= 255; v++) {
    lim.apply(v, v, v, o); cru.apply(v, v, v, p);
    for (let c = 0; c < 3; c++) if (o[c] < p[c] - 1e-9) nuncaMasOscuro = false;
    if (prev) for (let c = 0; c < 3; c++) {
      retroceso = Math.max(retroceso, prev[c] - o[c]);
      retrocesoAntes = Math.max(retrocesoAntes, prevCru[c] - p[c]);
      saltoMax = Math.max(saltoMax, o[c] - prev[c]);
    }
    prev = Array.from(o); prevCru = Array.from(p);
  }
  check(`${nombre}: casi-blancos nunca más oscuros que antes`, nuncaMasOscuro);
  check(`${nombre}: grises claros no retroceden más que antes`, retroceso <= retrocesoAntes + 1e-9, `ahora ${retroceso.toFixed(3)} antes ${retrocesoAntes.toFixed(3)}`);
  check(`${nombre}: sin escalón al llegar al blanco (salto máx ${saltoMax.toFixed(2)}/nivel)`, saltoMax < 8, 'salto=' + saltoMax.toFixed(2));

  // 7) aplicarla dos veces = una
  const dos = preservarBlanco(out, S);
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 = Math.max(d2, Math.abs(dos[i] - out[i]));
  check(`${nombre}: aplicarla dos veces da lo mismo`, d2 === 0, 'dif=' + d2);

  cru.apply(255, 255, 255, p);
  console.log(`  ${nombre}: blanco antes ${Array.from(p).map((x) => x.toFixed(1)).join(', ')} → ahora 255, 255, 255   (nodos retocados: ${tocados})`);
}

// Identidad: no cambia nada.
{
  const S = 17, l = new Lut3(S);
  for (let r = 0; r < S; r++) for (let g = 0; g < S; g++) for (let b = 0; b < S; b++) l.set(r, g, b, l.nodo(r), l.nodo(g), l.nodo(b));
  const out = preservarBlanco(l.V, S);
  let d = 0;
  for (let i = 0; i < out.length; i++) d = Math.max(d, Math.abs(out[i] - l.V[i]));
  check('identidad queda igual', d === 0);
}

console.log(`\n${ok} OK, ${bad} fallaron`);
console.log(bad === 0 ? '*** BLANCO OK ***' : '*** BLANCO FALLÓ ***');
process.exit(bad === 0 ? 0 : 1);
