// Geometría de "Imprimir con PrintLayout" para PDF.
//
// El caso que lo motivó: un PDF de 322x472 mm con la hoja de la impresora
// configurada en 322x472 y "Tamaño real" se veía cortado en la vista previa.
// Medido sobre la Ricoh MP C8003 real pidiéndole esa hoja personalizada:
//   PAPER 322.07 x 471.93 · PRINT 313.61 x 463.47 · MARGEN 4.23 / 4.23
// O sea que la máquina NO llega al borde: corta ~4,2 mm por lado. La vista
// previa estaba bien; lo que faltaba era decirlo.
//
// Corre con: npm run test:pdf-layout

import { calcTamano, recortes, filtrarSubset, parseRange } from '../pdfLayout.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};
const cerca = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

// Lo que mide de verdad la Ricoh con la hoja personalizada de 322x472.
const RICOH = {
  paperW: 322.07, paperH: 471.93,
  printW: 313.61, printH: 463.47,
  marginL: 4.23, marginT: 4.23,
};
const PDF = { wMm: 322.00, hMm: 472.02 }; // medido del PDF rasterizado a 96 dpi

console.log('\n1) Tamaño real en una hoja del mismo tamaño: la máquina corta el margen');
{
  const t = calcTamano({ ...PDF, rot: 0, printW: RICOH.printW, printH: RICOH.printH, sizeMode: 'actual', scalePct: 100 });
  check('no escala', cerca(t.factor, 1) && cerca(t.twMm, 322) && cerca(t.thMm, 472.02));
  const c = recortes({ twMm: t.twMm, thMm: t.thMm, ...RICOH });
  check('avisa que corta', c.hay);
  check('corta ~4,2 mm a la izquierda', cerca(c.izq, 4.2, 0.1), c.izq.toFixed(2));
  check('corta ~4,2 mm a la derecha', cerca(c.der, 4.2, 0.1), c.der.toFixed(2));
  check('corta ~4,3 mm arriba', cerca(c.arr, 4.28, 0.1), c.arr.toFixed(2));
  check('corta ~4,3 mm abajo', cerca(c.aba, 4.28, 0.1), c.aba.toFixed(2));
  check('el recorte es parejo (el diseño va centrado en la hoja)',
    cerca(c.izq, c.der, 0.01) && cerca(c.arr, c.aba, 0.01));
}

console.log('\n2) Con "Ajustar" entra entero y no corta nada');
{
  const t = calcTamano({ ...PDF, rot: 0, printW: RICOH.printW, printH: RICOH.printH, sizeMode: 'fit', scalePct: 100 });
  check('escala al 97%', cerca(Math.round(t.factor * 100), 97, 0.5), String(Math.round(t.factor * 100)));
  check('entra en el ancho imprimible', t.twMm <= RICOH.printW + 0.01, t.twMm.toFixed(2));
  check('entra en el alto imprimible', t.thMm <= RICOH.printH + 0.01, t.thMm.toFixed(2));
  const c = recortes({ twMm: t.twMm, thMm: t.thMm, ...RICOH });
  check('no corta nada', !c.hay, JSON.stringify(c));
}

console.log('\n3) "Ajustar páginas grandes" no agranda lo que ya entra');
{
  const chico = { wMm: 100, hMm: 150 };
  const t = calcTamano({ ...chico, rot: 0, printW: RICOH.printW, printH: RICOH.printH, sizeMode: 'fitlarge', scalePct: 100 });
  check('lo deja al 100%', cerca(t.factor, 1) && cerca(t.twMm, 100) && cerca(t.thMm, 150));
  const c = recortes({ twMm: t.twMm, thMm: t.thMm, ...RICOH });
  check('y no corta', !c.hay);
}

console.log('\n4) Rotado: el diseño apaisado sobre hoja vertical');
{
  const t = calcTamano({ wMm: 472.02, hMm: 322, rot: 90, printW: RICOH.printW, printH: RICOH.printH, sizeMode: 'actual', scalePct: 100 });
  check('intercambia ancho y alto', cerca(t.ew, 322) && cerca(t.eh, 472.02));
  const c = recortes({ twMm: t.twMm, thMm: t.thMm, ...RICOH });
  check('corta lo mismo que sin rotar', cerca(c.izq, 4.2, 0.1) && cerca(c.aba, 4.28, 0.1));
}

console.log('\n5) Escala personalizada');
{
  const t = calcTamano({ ...PDF, rot: 0, printW: RICOH.printW, printH: RICOH.printH, sizeMode: 'custom', scalePct: 50 });
  check('al 50% mide la mitad', cerca(t.twMm, 161) && cerca(t.thMm, 236.01));
  check('no corta', !recortes({ twMm: t.twMm, thMm: t.thMm, ...RICOH }).hay);
  const g = calcTamano({ ...PDF, rot: 0, printW: RICOH.printW, printH: RICOH.printH, sizeMode: 'custom', scalePct: 200 });
  const cg = recortes({ twMm: g.twMm, thMm: g.thMm, ...RICOH });
  check('al 200% corta muchísimo', cg.hay && cg.izq > 150, cg.izq.toFixed(1));
}

console.log('\n6) Hoja A4 con un diseño A4: también pierde el margen duro');
{
  const A4 = { paperW: 209.97, paperH: 296.93, printW: 201.51, printH: 288.46, marginL: 4.23, marginT: 4.23 };
  const t = calcTamano({ wMm: 210, hMm: 297, rot: 0, printW: A4.printW, printH: A4.printH, sizeMode: 'actual', scalePct: 100 });
  const c = recortes({ twMm: t.twMm, thMm: t.thMm, ...A4 });
  check('avisa', c.hay);
  check('~4,2 mm por lado', cerca(c.izq, 4.25, 0.1) && cerca(c.der, 4.25, 0.1), `${c.izq.toFixed(2)}/${c.der.toFixed(2)}`);
}

console.log('\n7) Páginas: rango e impares/pares');
{
  check('rango simple', JSON.stringify(parseRange('1-3,5', 10)) === '[1,2,3,5]', JSON.stringify(parseRange('1-3,5', 10)));
  check('rango al revés se ordena', JSON.stringify(parseRange('5-3', 10)) === '[3,4,5]');
  check('no se pasa del total', JSON.stringify(parseRange('8-20', 10)) === '[8,9,10]');
  check('sin repetidos', JSON.stringify(parseRange('2,2,2-3', 10)) === '[2,3]');
  check('basura da vacío', parseRange('abc', 10).length === 0);

  const todas = [1, 2, 3, 4, 5, 6, 7];
  check('impares', JSON.stringify(filtrarSubset(todas, 'odd')) === '[1,3,5,7]');
  check('pares', JSON.stringify(filtrarSubset(todas, 'even')) === '[2,4,6]');
  check('todas', JSON.stringify(filtrarSubset(todas, 'all')) === '[1,2,3,4,5,6,7]');
  check('impares dentro de un rango', JSON.stringify(filtrarSubset(parseRange('3-8', 10), 'odd')) === '[3,5,7]');
  // Doble faz a mano: impares + pares tienen que dar TODAS, sin repetir ni perder.
  const i = filtrarSubset(todas, 'odd'), p = filtrarSubset(todas, 'even');
  check('impares + pares = todas', [...i, ...p].sort((a, b) => a - b).join() === todas.join());
}

console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exit(fail ? 1 : 0);
