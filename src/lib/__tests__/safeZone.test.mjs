// Zona segura (línea verde punteada): se calcula UNA vez por forma distinta y a
// los demás stickers iguales solo se los traslada. El dibujo tiene que salir
// igual que cuando se calculaba uno por uno.
// Corre con: npm run test:zona-segura
import { safeZoneCuts } from '../safeZone.js';
import { offsetPolygons } from '../contour/offset.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};

// Como se hacía antes: un cálculo por cada corte, en su lugar.
function unoPorUno(cortes, s) {
  const out = [];
  for (const poly of cortes) {
    const cp = poly.map(([x, y]) => ({ X: Math.round(x * 1000), Y: Math.round(y * 1000) }));
    const { polys } = offsetPolygons([cp], -s, { joinType: 'miter' });
    for (const sol of polys) if (sol && sol.length >= 3) out.push(sol.map((p) => [p.X / 1000, p.Y / 1000]));
  }
  return out;
}
const caja = (poly) => {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const cajasIguales = (a, b, tol) => a.length === b.length && a.every((p, i) => caja(p).every((v, k) => Math.abs(v - caja(b[i])[k]) <= tol));
const r3 = (v) => Math.round(v * 1000) / 1000;

// Un sticker "festoneado" de ~1400 puntos (como el de la hoja real), de 31 mm.
function festoneado(cx, cy, n = 1400) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 15.5 + 1.2 * Math.cos(a * 12);
    pts.push([r3(cx + r * Math.cos(a)), r3(cy + r * Math.sin(a))]); // guardado con 3 decimales, como en la app
  }
  pts.push([pts[0][0], pts[0][1]]);
  return pts;
}
const cuadrado = (x, y, l) => [[x, y], [x + l, y], [x + l, y + l], [x, y + l], [x, y]];

console.log('\n1) Hoja de 96 stickers iguales');
{
  const cortes = [];
  for (let f = 0; f < 12; f++) for (let c = 0; c < 8; c++) cortes.push(festoneado(32.233 + c * 37.001, 29.147 + f * 37.003));
  const st = {};
  const t0 = performance.now();
  const nuevo = safeZoneCuts(cortes, 2, st);
  const ms = performance.now() - t0;
  const t1 = performance.now();
  const viejo = unoPorUno(cortes, 2);
  const msViejo = performance.now() - t1;
  check('se calcula UNA sola vez (antes 96)', st.calculos === 1, String(st.calculos));
  check('salen las 96 zonas', nuevo.length === 96, String(nuevo.length));
  check('cada una queda en el mismo lugar que antes (±0,01 mm)', cajasIguales(nuevo, viejo, 0.01));
  check('la zona queda adentro del corte', caja(nuevo[0])[0] > caja(cortes[0])[0] + 1.9 && caja(nuevo[0])[2] < caja(cortes[0])[2] - 1.9);
  check(`bastante más rápido (${Math.round(ms)} ms contra ${Math.round(msViejo)} ms)`, ms < msViejo / 4, `${ms} vs ${msViejo}`);
}

console.log('\n2) Formas distintas no se confunden');
{
  const st = {};
  const cortes = [cuadrado(10, 10, 40), cuadrado(60, 10, 40), cuadrado(110, 10, 30), festoneado(50, 100, 200), festoneado(120, 100, 200)];
  const nuevo = safeZoneCuts(cortes, 2, st);
  check('3 formas distintas = 3 cálculos', st.calculos === 3, String(st.calculos));
  check('igual que uno por uno', cajasIguales(nuevo, unoPorUno(cortes, 2), 0.01));
  const c0 = caja(nuevo[0]), c1 = caja(nuevo[1]);
  check('cuadrado de 40 con margen 2 → 36, en su lugar', Math.abs(c0[2] - c0[0] - 36) < 0.001 && Math.abs(c0[0] - 12) < 0.001 && Math.abs(c1[0] - 62) < 0.001, JSON.stringify([c0, c1]));
  // Mismo número de puntos, forma distinta (rectángulo vs cuadrado).
  const st2 = {};
  const rect = [[10, 10], [70, 10], [70, 30], [10, 30], [10, 10]];
  const dos = safeZoneCuts([cuadrado(10, 10, 40), rect], 2, st2);
  check('misma cantidad de puntos pero otra forma: se calcula aparte', st2.calculos === 2 && cajasIguales(dos, unoPorUno([cuadrado(10, 10, 40), rect], 2), 0.01));
  // Casi igual pero no (1 mm de diferencia en un punto): no se toma por la misma.
  const st3 = {};
  const casi = cuadrado(60, 10, 40); casi[2] = [101, 50];
  safeZoneCuts([cuadrado(10, 10, 40), casi], 2, st3);
  check('una diferencia de 1 mm NO se toma por la misma forma', st3.calculos === 2, String(st3.calculos));
}

console.log('\n3) Casos que no llevan zona segura');
{
  check('margen 0: nada', safeZoneCuts([cuadrado(0, 0, 40)], 0).length === 0);
  check('recorrido abierto (corte lineal / en S): nada', safeZoneCuts([[[0, 0], [100, 0]], [[0, 0], [50, 20], [100, 0]]], 2).length === 0);
  check('pieza más chica que el margen: nada, sin romper', safeZoneCuts([cuadrado(0, 0, 3)], 2).length === 0);
  check('sin cortes: nada', safeZoneCuts([], 2).length === 0 && safeZoneCuts(null, 2).length === 0);
  const mezcla = safeZoneCuts([[[0, 0], [100, 0]], cuadrado(10, 10, 40), null], 2);
  check('mezcla de abiertos y cerrados: solo los cerrados', mezcla.length === 1);
}

console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exitCode = fail ? 1 : 0;
