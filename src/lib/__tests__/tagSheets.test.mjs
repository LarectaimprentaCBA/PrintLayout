// Planchas de tags: qué corte es silueta y cuál agujero, y cómo queda el corte
// con / sin agujero. node src/lib/__tests__/tagSheets.test.mjs
import {
  classifyTagCuts, tagSheetInfo, tagHoleDefaults, buildTagCuts,
  mirrorCutsX, mirrorCellsX, checkTagSheet, isTagSheet,
} from '../tagSheets.js';

let ok = 0; let fail = 0;
function t(cond, msg) {
  if (cond) { ok++; console.log(`ok   - ${msg}`); } else { fail++; console.log(`FAIL - ${msg}`); }
}

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const circle = (cx, cy, r, n = 32) => {
  const p = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return p;
};
// Silueta de tag: rectángulo con la punta de arriba en pico.
const tag = (x, y, w, h) => [[x, y + 12], [x + w / 2, y], [x + w, y + 12], [x + w, y + h], [x, y + h], [x, y + 12]];

// --- Plancha con agujeros dibujados: 3 tags, cada uno con su agujero. El PDF los
//     trae en cualquier orden (primero las siluetas, después los agujeros).
const conAgujero = [
  tag(20, 20, 40, 70), tag(70, 20, 40, 70), tag(120, 20, 40, 70),
  circle(40, 32, 2), circle(90, 32, 2), circle(140, 32, 2),
];
{
  const piezas = classifyTagCuts(conAgujero);
  t(piezas.length === 3, '3 siluetas = 3 piezas');
  t(piezas.every((p) => p.holes.length === 1), 'cada pieza tiene su agujero');
  t(piezas[0].outer === 0 && piezas[0].holes[0] === 3, 'el agujero queda con SU tag (no con el vecino)');
  const info = tagSheetInfo(conAgujero);
  t(info.pieces === 3 && info.withHole === 3 && info.holes === 3, 'resumen: 3 tags, 3 con agujero');
  t(tagHoleDefaults(conAgujero).cut === true, 'si la plancha trae agujero, arranca cortándolo');

  const con = buildTagCuts(conAgujero, { cut: true });
  t(con.length === 6, 'con agujero: salen las 6 líneas');
  t(con[0] === conAgujero[3] && con[1] === conAgujero[0], 'orden por pieza: primero el agujero, después la silueta');
  t(con[2] === conAgujero[4] && con[3] === conAgujero[1] && con[4] === conAgujero[5] && con[5] === conAgujero[2], 'y así con las tres');

  const sin = buildTagCuts(conAgujero, { cut: false });
  t(sin.length === 3, 'sin agujero: solo las 3 siluetas');
  t(sin[0] === conAgujero[0] && sin[1] === conAgujero[1] && sin[2] === conAgujero[2], 'las siluetas quedan tal cual');
}

// --- Plancha SIN agujero dibujado: se agrega desde la app.
const sinAgujero = [tag(20, 20, 40, 70), tag(70, 20, 40, 70)];
{
  t(tagSheetInfo(sinAgujero).holes === 0, 'sin agujeros dibujados');
  t(tagHoleDefaults(sinAgujero).cut === false, 'si no trae agujero, arranca sin cortarlo');
  t(buildTagCuts(sinAgujero, { cut: false }).length === 2, 'apagado: solo las siluetas');

  const con = buildTagCuts(sinAgujero, { cut: true, diameterMm: 4, fromTopMm: 6, dxMm: 0 });
  t(con.length === 4, 'prendido: la app agrega un agujero por tag');
  const hoyo = con[0];
  const xs = hoyo.map((p) => p[0]); const ys = hoyo.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2; const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  t(Math.abs(cx - 40) < 0.01, 'el agujero queda centrado en el ancho del tag');
  t(Math.abs(cy - 26) < 0.01, 'a 6 mm del borde de arriba de la silueta');
  t(Math.abs((Math.max(...xs) - Math.min(...xs)) - 4) < 0.05, 'de 4 mm de diámetro');
  t(con[1] === sinAgujero[0], 'después del agujero va la silueta');

  const corrido = buildTagCuts(sinAgujero, { cut: true, diameterMm: 4, fromTopMm: 6, dxMm: -5 });
  const cxs = corrido[0].map((p) => p[0]);
  t(Math.abs((Math.min(...cxs) + Math.max(...cxs)) / 2 - 35) < 0.01, 'el corrimiento horizontal lo mueve');
  t(buildTagCuts(sinAgujero, { cut: true, diameterMm: 0 }).length === 2, 'diámetro 0 = no agrega nada');
}

// --- Plancha mezclada: un tag con agujero dibujado y otro sin.
{
  const mezcla = [tag(20, 20, 40, 70), circle(40, 32, 2), tag(70, 20, 40, 70)];
  const info = tagSheetInfo(mezcla);
  t(info.withHole === 1 && info.withoutHole === 1, 'mezcla: 1 con y 1 sin');
  const con = buildTagCuts(mezcla, { cut: true, diameterMm: 4, fromTopMm: 5 });
  t(con.length === 4, 'el que no lo trae recibe el de la app');
  t(con[0] === mezcla[1], 'el que lo trae usa el SUYO (no se le agrega otro)');
}

// --- Cortes repetidos (Corel exporta la misma curva dos veces): ninguno se toma
//     por agujero del otro, así apagar el agujero no borra la silueta.
{
  const repetido = [rect(20, 20, 40, 60), rect(20, 20, 40, 60), circle(40, 30, 2)];
  const sin = buildTagCuts(repetido, { cut: false });
  t(sin.length === 2, 'silueta repetida: se conservan las dos');
  t(tagSheetInfo(repetido).holes === 1, 'y el agujero se cuenta una sola vez');
}

// --- Un corte adentro del agujero (arandela) sigue siendo de la misma pieza.
{
  const anidado = [rect(10, 10, 60, 60), circle(40, 40, 10), circle(40, 40, 3)];
  const piezas = classifyTagCuts(anidado);
  t(piezas.length === 1 && piezas[0].holes.length === 2, 'los cortes anidados van todos a la pieza de afuera');
  t(buildTagCuts(anidado, { cut: false }).length === 1, 'sin agujero queda solo la silueta');
}

// --- Vacío / basura.
{
  t(buildTagCuts([], { cut: true }).length === 0, 'sin cortes no rompe');
  t(buildTagCuts(null, null).length === 0, 'null no rompe');
  t(isTagSheet({ tags: { cortesBase: [] } }) === true && isTagSheet({ celdas: [] }) === false && isTagSheet(null) === false, 'isTagSheet');
}

// --- Espejos.
{
  const m = mirrorCutsX([rect(10, 20, 30, 40)], 200);
  t(Math.min(...m[0].map((p) => p[0])) === 160 && Math.max(...m[0].map((p) => p[0])) === 190, 'espejar corte en X');
  const c = mirrorCellsX([{ id: 7, x: 10, y: 20, w: 30, h: 15 }], 200);
  t(c[0].x === 160 && c[0].y === 20 && c[0].w === 30 && c[0].id === 7, 'espejar recuadros en X');
}

// --- Avisos de la plancha.
{
  const W = 325; const H = 500; const m = 15;
  // Bien armada y simétrica: dos tags centrados, logos detrás.
  const bien = [tag(100, 100, 50, 80), tag(175, 100, 50, 80)];
  const cajasBien = [{ x: 110, y: 150, w: 30, h: 15 }, { x: 185, y: 150, w: 30, h: 15 }];
  t(checkTagSheet({ cortesBase: bien, celdasDorso: cajasBien, pageWidthMm: W, pageHeightMm: H, markMarginMm: m }).length === 0, 'plancha bien armada: sin avisos');

  // Tag pegado al borde.
  const borde = [tag(5, 100, 50, 80)];
  const w1 = checkTagSheet({ cortesBase: borde, celdasDorso: [], pageWidthMm: W, pageHeightMm: H, markMarginMm: m });
  t(w1.length === 1 && /a menos de 15 mm del borde/.test(w1[0]), 'avisa si un tag queda en la zona de las marcas');

  // Tag sobre una marca de esquina.
  const esquina = [rect(16, 16, 40, 40)];
  const w2 = checkTagSheet({ cortesBase: esquina, celdasDorso: [], pageWidthMm: W, pageHeightMm: H, markMarginMm: m });
  t(w2.length === 1 && /pisa una marca/.test(w2[0]), 'avisa si un tag pisa una marca');

  // Plancha NO simétrica con el dorso sin espejar.
  const asim = [tag(30, 100, 50, 80)];
  const cajaSinEspejar = [{ x: 40, y: 150, w: 30, h: 15 }];
  const w3 = checkTagSheet({ cortesBase: asim, celdasDorso: cajaSinEspejar, pageWidthMm: W, pageHeightMm: H, markMarginMm: m });
  t(w3.length === 1 && /SIN espejar/.test(w3[0]), 'avisa si el dorso está sin espejar');
  const cajaEspejada = [{ x: W - 40 - 30, y: 150, w: 30, h: 15 }];
  t(checkTagSheet({ cortesBase: asim, celdasDorso: cajaEspejada, pageWidthMm: W, pageHeightMm: H, markMarginMm: m }).length === 0, 'con el dorso espejado no avisa');

  // Recuadro perdido.
  const w4 = checkTagSheet({ cortesBase: asim, celdasDorso: [{ x: 150, y: 300, w: 20, h: 10 }], pageWidthMm: W, pageHeightMm: H, markMarginMm: m });
  t(w4.length === 1 && /no cae detrás de ningún tag/.test(w4[0]), 'avisa si un recuadro de logo queda suelto');
}

console.log(`\n${ok} OK, ${fail} FALLARON`);
process.exit(fail ? 1 : 0);
