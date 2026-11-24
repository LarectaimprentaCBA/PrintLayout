// Qué hojas manda la ventana "Imprimir". Corre con: npm run test:paginas-imprimir
import {
  pagesToPrintFor, parseRange, rememberedPageChoice, pageChoiceToSave, loadPageChoice, savePageChoice,
} from '../printPages.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};
const j = (v) => JSON.stringify(v);

console.log('\n1) El caso que trababa el botón Imprimir');
// Trabajo anterior: 5 hojas, se imprimió "Rango 2-3". Trabajo de ahora: 1 hoja
// (el selector de páginas no se muestra). Antes daba null → botón apagado.
check('rango viejo "2-3" con 1 sola hoja: se imprime esa hoja', j(pagesToPrintFor('range', '2-3', 1, 0)) === '[0]',
  j(pagesToPrintFor('range', '2-3', 1, 0)));
check('rango vacío con 1 sola hoja: igual', j(pagesToPrintFor('range', '', 1, 0)) === '[0]');
check('"Actual" de la hoja 4 con 1 sola hoja: la única', j(pagesToPrintFor('current', '', 1, 3)) === '[0]');
check('si la cuenta de hojas viene en 0, igual hay una', j(pagesToPrintFor('all', '', 0, 0)) === '[0]');
check('ídem si viene vacía', j(pagesToPrintFor('all', '', undefined, 0)) === '[0]');

console.log('\n2) Con varias hojas sigue igual que siempre');
check('todas', j(pagesToPrintFor('all', '', 4, 0)) === '[0,1,2,3]');
check('actual', j(pagesToPrintFor('current', '', 4, 2)) === '[2]');
check('actual fuera de rango se acomoda', j(pagesToPrintFor('current', '', 4, 9)) === '[3]');
check('rango "1-3,5" de 6', j(pagesToPrintFor('range', '1-3,5', 6, 0)) === '[0,1,2,4]');
check('rango al revés "3-1"', j(pagesToPrintFor('range', '3-1', 6, 0)) === '[0,1,2]');
check('rango que se pasa de hojas: no sirve (y ahí SÍ se ve el aviso)', pagesToPrintFor('range', '2-9', 4, 0) === null);
check('rango vacío: no sirve', pagesToPrintFor('range', '', 4, 0) === null);
check('rango con letras: no sirve', pagesToPrintFor('range', 'dos', 4, 0) === null);
check('parseRange sin repetidos y ordenado', j(parseRange('5,1-2,2', 6)) === '[0,1,4]');

console.log('\n3) Queda elegido lo que se usó la última vez (sin trabar)');
{
  // Un "localStorage" de mentira, para probar guardar + leer de punta a punta.
  const caja = new Map();
  const storage = { getItem: (k) => (caja.has(k) ? caja.get(k) : null), setItem: (k, v) => caja.set(k, String(v)) };
  const usar = (modo, rango, trabajo, hojas) => savePageChoice(storage, pageChoiceToSave(modo, rango, trabajo, hojas));
  const abrir = (trabajo, hojas) => rememberedPageChoice(loadPageChoice(storage), trabajo, hojas);
  const es = (r, modo, rango = '') => r.mode === modo && r.rangeText === rango;

  check('primera vez (nada guardado): Todas', es(abrir('A', 4), 'all'));
  usar('current', '', 'A', 4);
  check('usé "Actual" y vuelvo a imprimir: sigue en "Actual"', es(abrir('A', 4), 'current'));
  check('…también en otro trabajo', es(abrir('B', 7), 'current'));
  check('…y lo que sale es la hoja que estoy mirando', j(pagesToPrintFor(abrir('B', 7).mode, '', 7, 5)) === '[5]');
  check('…con 1 sola hoja no molesta: imprime esa', j(pagesToPrintFor(abrir('C', 1).mode, '', 1, 0)) === '[0]');
  usar('all', '', 'C', 1);
  check('imprimir un trabajo de 1 hoja NO borra lo recordado', es(abrir('A', 4), 'current'));

  usar('range', ' 2-3 ', 'A', 5);
  check('usé "Rango 2-3" y vuelvo al MISMO trabajo: queda el rango', es(abrir('A', 5), 'range', '2-3'));
  check('en OTRO trabajo el rango no se arrastra: Todas', es(abrir('B', 5), 'all'));
  check('mismo trabajo pero ahora tiene 2 hojas (el 2-3 no entra): Todas, no trabado', es(abrir('A', 2), 'all'));
  check('mismo trabajo con 1 sola hoja: Todas', es(abrir('A', 1), 'all'));
  check('sin identificar el trabajo: no se arrastra el rango', es(rememberedPageChoice({ mode: 'range', rangeText: '2-3', jobKey: null }, null, 5), 'all'));

  usar('all', '', 'A', 5);
  check('usé "Todas": queda en Todas', es(abrir('A', 5), 'all'));

  // Lo que se abre NUNCA deja el botón apagado.
  let trabado = 0;
  for (const guardado of [null, {}, { mode: 'current' }, { mode: 'range', rangeText: '9-12', jobKey: 'A' }, { mode: 'range', rangeText: 'x', jobKey: 'A' }, { mode: 'cualquiera' }, 'basura']) {
    for (const hojas of [0, 1, 2, 5, 12]) {
      const r = rememberedPageChoice(guardado, 'A', hojas);
      const p = pagesToPrintFor(r.mode, r.rangeText, hojas, 0);
      if (!Array.isArray(p) || p.length === 0) trabado++;
    }
  }
  check('con cualquier cosa guardada, al abrir siempre hay hojas para imprimir', trabado === 0, String(trabado));
  caja.set('printlayout.lastPageChoice', '{roto');
  check('si lo guardado está roto: Todas', es(abrir('A', 4), 'all'));
}

console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exitCode = fail ? 1 : 0;
