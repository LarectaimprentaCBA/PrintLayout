// Qué hojas manda la ventana "Imprimir". Corre con: npm run test:paginas-imprimir
import { pagesToPrintFor, parseRange } from '../printPages.js';

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

console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exitCode = fail ? 1 : 0;
