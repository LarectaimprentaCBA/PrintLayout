// Corte continuo de círculos pegados ("en S").
//
// La idea (Mariano la vio en un video, 11/11/2026): los círculos tardan mucho
// porque cada uno es un recorrido cerrado aparte — bajar la cuchilla, dar la
// vuelta, subirla, viajar al siguiente. Con los círculos PEGADOS se puede hacer
// abajo-arriba-abajo-arriba en UN solo trazo con forma de onda, y una segunda
// onda completa los círculos.
//
// Lo que esta prueba tiene que garantizar, porque se corta papel de verdad:
//  1. que los círculos queden ENTEROS (si falta un pedacito, la pieza no sale)
//  2. que el trazo sea CONTINUO (si hay un salto, la cuchilla cortó derecho por
//     el medio de la hoja)
//  3. que en las uniones no haya ESQUINA (es toda la gracia del asunto)
//  4. que si la fila no da para encadenar, caiga al corte de siempre
//
// Corre con: npm run test:serpentine

import { cellsToSerpentineCircleCuts, cellsToCircleCuts, computeGrid } from '../grid.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// Fila de n círculos pegados de diámetro D, arrancando en (x0,y0).
const fila = (n, D = 40, x0 = 10, y0 = 10) =>
  Array.from({ length: n }, (_, i) => ({ x: x0 + i * D, y: y0, w: D, h: D }));

// Ángulo (0..360) de un punto respecto del centro de su círculo. El % 360 del
// final no es decoración: un punto calculado en 360° exactos da un pelín menos
// que cero, y al sumarle 360 el redondeo lo deja en 360 clavado.
const angDe = (p, cx, cy) => {
  const a = (Math.atan2(p[1] - cy, p[0] - cx) * 180) / Math.PI;
  return ((a % 360) + 360) % 360;
};

console.log('\n1) Una fila de 5 círculos: dos trazos, no cinco');
{
  const cells = fila(5);
  const cuts = cellsToSerpentineCircleCuts(cells);
  check('salen 2 recorridos', cuts.length === 2, String(cuts.length));
  check('contra 5 del corte de siempre', cellsToCircleCuts(cells).length === 5);
  const bajadas = cuts.length;
  check('la cuchilla baja 2 veces en vez de 5', bajadas === 2, String(bajadas));
}

console.log('\n2) El trazo es CONTINUO (no hay saltos en el aire)');
{
  const cells = fila(6, 40);
  for (const [n, onda] of cellsToSerpentineCircleCuts(cells).entries()) {
    let maxSalto = 0;
    for (let i = 1; i < onda.length; i++) maxSalto = Math.max(maxSalto, dist(onda[i - 1], onda[i]));
    // Paso de 32 tramos por media circunferencia de r=20 → ~2 mm. Un salto
    // real (de un círculo al otro) serían 40 mm.
    check(`onda ${n + 1}: ningún salto (máx ${maxSalto.toFixed(2)} mm)`, maxSalto < 4, maxSalto.toFixed(2));
  }
}

console.log('\n3) Cada círculo queda ENTERO entre las dos ondas');
{
  const D = 40, n = 5;
  const cells = fila(n, D);
  const cuts = cellsToSerpentineCircleCuts(cells);
  const todos = cuts.flat();
  for (let i = 0; i < n; i++) {
    const cx = cells[i].x + D / 2, cy = cells[i].y + D / 2, r = D / 2;
    // Puntos que caen sobre ESTE círculo.
    const sobre = todos.filter((p) => Math.abs(dist(p, [cx, cy]) - r) < 0.01);
    // ¿Cubren las 360°? Partimos la vuelta en 36 porciones de 10°.
    const porciones = new Set(sobre.map((p) => Math.floor(angDe(p, cx, cy) / 10)));
    check(`círculo ${i + 1}: la vuelta completa (${porciones.size}/36 porciones)`,
      porciones.size === 36, `faltan ${36 - porciones.size}`);
  }
}

console.log('\n4) En las uniones no hay esquina');
{
  const cells = fila(4, 40);
  for (const [n, onda] of cellsToSerpentineCircleCuts(cells).entries()) {
    let peor = 0;
    for (let i = 2; i < onda.length; i++) {
      const a = [onda[i - 1][0] - onda[i - 2][0], onda[i - 1][1] - onda[i - 2][1]];
      const b = [onda[i][0] - onda[i - 1][0], onda[i][1] - onda[i - 1][1]];
      const la = Math.hypot(...a), lb = Math.hypot(...b);
      if (la < 1e-9 || lb < 1e-9) continue;
      const cos = Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1]) / (la * lb)));
      peor = Math.max(peor, (Math.acos(cos) * 180) / Math.PI);
    }
    // Entre tramos de la misma curva el giro es el paso angular (~5,6°). Una
    // esquina de verdad daría decenas de grados.
    check(`onda ${n + 1}: giro máximo ${peor.toFixed(1)}° (curva, no esquina)`, peor < 12, peor.toFixed(1));
  }
}

console.log('\n5) La segunda onda arranca donde terminó la primera');
{
  const [a, b] = cellsToSerpentineCircleCuts(fila(4, 40));
  check('no cruza la fila en el aire', dist(a[a.length - 1], b[0]) < 3,
    dist(a[a.length - 1], b[0]).toFixed(2));
}

console.log('\n6) Si la fila no da para encadenar, corta como siempre');
{
  // Con separación entre piezas no se tocan.
  const separados = [
    { x: 10, y: 10, w: 40, h: 40 },
    { x: 55, y: 10, w: 40, h: 40 },
    { x: 100, y: 10, w: 40, h: 40 },
  ];
  const c1 = cellsToSerpentineCircleCuts(separados);
  check('separados → un círculo cerrado por pieza', c1.length === 3, String(c1.length));
  check('y cada uno cierra sobre sí mismo',
    c1.every((p) => dist(p[0], p[p.length - 1]) < 0.01));

  // Tamaños distintos: tampoco empalman.
  const mixtos = [
    { x: 10, y: 10, w: 40, h: 40 },
    { x: 50, y: 10, w: 30, h: 30 },
  ];
  check('tamaños distintos → tampoco encadena', cellsToSerpentineCircleCuts(mixtos).length === 2);

  // Uno solo.
  check('una sola pieza → un círculo', cellsToSerpentineCircleCuts(fila(1)).length === 1);
  check('sin piezas → nada', cellsToSerpentineCircleCuts([]).length === 0);
}

console.log('\n7) Varias filas: dos trazos por fila');
{
  const cells = [...fila(4, 40, 10, 10), ...fila(4, 40, 10, 50), ...fila(4, 40, 10, 90)];
  const cuts = cellsToSerpentineCircleCuts(cells);
  check('3 filas → 6 recorridos', cuts.length === 6, String(cuts.length));
  check('contra 12 de antes', cellsToCircleCuts(cells).length === 12);
  // Las filas salen de arriba hacia abajo.
  const yMedio = cuts.map((o) => o.reduce((s, p) => s + p[1], 0) / o.length);
  check('las filas van en orden, de arriba hacia abajo',
    yMedio[0] < yMedio[2] && yMedio[2] < yMedio[4], yMedio.map((v) => v.toFixed(0)).join(','));
}

console.log('\n8) Con una grilla hecha por la app (computeGrid)');
{
  // Círculos de 40 mm pegados en A4, como los arma la grilla rápida.
  const g = computeGrid({ paperW: 210, paperH: 297, cellW: 40, cellH: 40, marginX: 10, marginY: 10, spacingX: 0, spacingY: 0 });
  const cells = g.celdas ?? g.cells ?? [];
  check('la grilla dio celdas', cells.length > 0, String(cells.length));
  if (cells.length) {
    const cuts = cellsToSerpentineCircleCuts(cells);
    const filas = new Set(cells.map((c) => Math.round(c.y))).size;
    check(`${cells.length} círculos en ${filas} filas → ${cuts.length} recorridos`,
      cuts.length === filas * 2, `esperaba ${filas * 2}`);
    check('todos los puntos caen sobre algún círculo',
      cuts.flat().every((p) => cells.some((c) => {
        const r = Math.min(c.w, c.h) / 2;
        return Math.abs(dist(p, [c.x + c.w / 2, c.y + c.h / 2]) - r) < 0.01;
      })));
  }
}

console.log('\n9) DEMASÍA: el corte se mete adentro y los círculos SIGUEN pegados');
{
  // Mariano, cortando en papel: "el corte da justo al borde y no tiene nada de
  // demasía, entonces el plotter como desfasa un poquito quedan bordes blancos".
  // La celda es lo IMPRESO y el corte va adentro: con margen `m` el diseño sobra
  // `m` por fuera del corte. Para que la onda siga andando, los CÍRCULOS tienen
  // que tocarse, así que las celdas se solapan 2*m (el modal lo hace solo).
  const m = 0.4, D = 40;
  const paso = D - 2 * m; // distancia entre centros = diámetro de corte
  const cells = Array.from({ length: 4 }, (_, i) => ({ x: 10 + i * paso, y: 10, w: D, h: D }));
  const cuts = cellsToSerpentineCircleCuts(cells, { cutMarginMm: m });
  check('con demasía sigue encadenando: 2 ondas', cuts.length === 2, String(cuts.length));

  const r = D / 2 - m;
  // El corte es más chico que el diseño: queda la demasía.
  const todos = cuts.flat();
  const c0 = cells[0];
  const sobre = todos.filter((p) => Math.abs(dist(p, [c0.x + D / 2, c0.y + D / 2]) - r) < 0.01);
  check(`el corte tiene radio ${r} (${m} mm adentro del diseño)`, sobre.length > 0, String(sobre.length));
  check('y el círculo sigue entero',
    new Set(sobre.map((p) => Math.floor(angDe(p, c0.x + D / 2, c0.y + D / 2) / 10))).size === 36);
  // Continuo igual que sin demasía.
  let maxSalto = 0;
  for (let i = 1; i < cuts[0].length; i++) maxSalto = Math.max(maxSalto, dist(cuts[0][i - 1], cuts[0][i]));
  check(`sin saltos (máx ${maxSalto.toFixed(2)} mm)`, maxSalto < 4, maxSalto.toFixed(2));

  // Y si las celdas NO se solapan, los círculos quedan separados: no encadena.
  const malas = Array.from({ length: 4 }, (_, i) => ({ x: 10 + i * D, y: 10, w: D, h: D }));
  check('celdas pegadas + demasía → círculos separados → no encadena',
    cellsToSerpentineCircleCuts(malas, { cutMarginMm: m }).length === 4,
    String(cellsToSerpentineCircleCuts(malas, { cutMarginMm: m }).length));
}

console.log('\n10) Separación ENTRE FILAS: la onda no se entera');
{
  // Mariano, después de cortar en papel: levantan el descarte para revisar el
  // corte, y con todo pegado por los 4 lados el descarte queda en pedacitos
  // sueltos. Con una calle entre filas queda de una pieza y se levanta entero.
  // La onda va a lo ancho de la fila, así que la separación vertical no la toca.
  const D = 40, sep = 3;
  const cells = [...fila(3, D, 10, 10), ...fila(3, D, 10, 10 + D + sep)];
  const cuts = cellsToSerpentineCircleCuts(cells);
  check('2 filas separadas → siguen siendo 2 ondas por fila', cuts.length === 4, String(cuts.length));
  check('contra 6 círculos sueltos', cellsToCircleCuts(cells).length === 6);
  // Y los círculos no se tocan entre filas: queda la calle.
  const c1 = cells[0], c2 = cells[3];
  const entre = (c2.y + D / 2) - (c1.y + D / 2) - D;
  check(`queda la calle de ${sep} mm entre filas`, Math.abs(entre - sep) < 0.01, entre.toFixed(2));
  // Cada círculo, igual de entero que antes.
  const todos = cuts.flat();
  const enteros = cells.every((c) => {
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2, r = Math.min(c.w, c.h) / 2;
    const sobre = todos.filter((p) => Math.abs(dist(p, [cx, cy]) - r) < 0.01);
    return new Set(sobre.map((p) => Math.floor(angDe(p, cx, cy) / 10))).size === 36;
  });
  check('todos los círculos siguen enteros', enteros);
}

console.log('\n11) Las ondas son ABIERTAS: no son el contorno de una pieza');
{
  // Esto no es un detalle: la "zona segura" del preview achicaba cada recorrido
  // como si fuera un polígono cerrado, y con las ondas dibujaba un engendro
  // (media luna cerrada con una recta a lo ancho de la hoja). Lo vio Mariano en
  // la primera prueba. El corte en sí estaba bien: el .plt baja la cuchilla en
  // el primer punto y la sube en el último, no cierra la figura.
  const cells = fila(5, 40);
  for (const [n, onda] of cellsToSerpentineCircleCuts(cells).entries()) {
    check(`onda ${n + 1}: empieza y termina en puntos distintos`,
      dist(onda[0], onda[onda.length - 1]) > 1,
      dist(onda[0], onda[onda.length - 1]).toFixed(2));
  }
  // Lo que SÍ es el contorno de cada pieza, y es lo que usa la zona segura.
  const piezas = cellsToCircleCuts(cells, { cutMarginMm: 0 });
  check('hay un contorno cerrado por pieza', piezas.length === cells.length, String(piezas.length));
  check('y cada uno cierra sobre sí mismo',
    piezas.every((p) => dist(p[0], p[p.length - 1]) < 0.01));
}

console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exit(fail ? 1 : 0);
