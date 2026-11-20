// Editar PDF: sacar páginas, reordenar, sumar páginas de otro PDF.
// Corre con: npm run test:editar-pdf
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  buildEditedPdf, removePages, insertPagesAfter, movePagesBefore, shiftPages,
} from '../pdfEdit.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};

// Un PDF de prueba donde cada página tiene un ANCHO distinto (así se reconoce
// cuál es cuál en el resultado) y un texto.
async function pdfDe(anchos, etiqueta) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  anchos.forEach((w, i) => { const p = d.addPage([w, 500]); p.drawText(`${etiqueta} ${i + 1}`, { x: 20, y: 400, size: 24, font: f }); });
  return d.save();
}
const anchosDe = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => Math.round(p.getWidth()));
const lista = (docId, n) => Array.from({ length: n }, (_, i) => ({ key: `${docId}:${i}`, docId, pageIndex: i }));
const claves = (ps) => ps.map((p) => p.key).join(' ');

const A = await pdfDe([100, 110, 120, 130, 140], 'original');
const B = await pdfDe([300, 310], 'modificada');
const fuentes = new Map([['a', A], ['b', B]]);

console.log('\n1) Sin tocar nada, sale igual');
{
  const r = await buildEditedPdf(fuentes, lista('a', 5));
  check('las 5 páginas en el mismo orden', (await anchosDe(r)).join() === '100,110,120,130,140', (await anchosDe(r)).join());
}

console.log('\n2) El caso pedido: sacar páginas y poner las modificadas en su lugar');
{
  // Se sacan la 2 y la 4, y en el lugar de la 2 entran las dos modificadas.
  let ps = lista('a', 5);
  ps = insertPagesAfter(ps, lista('b', 2), 'a:1');
  ps = removePages(ps, ['a:1', 'a:3']);
  check('la lista queda como se espera', claves(ps) === 'a:0 b:0 b:1 a:2 a:4', claves(ps));
  const r = await buildEditedPdf(fuentes, ps);
  check('el PDF sale con esas páginas, en ese orden', (await anchosDe(r)).join() === '100,300,310,120,140', (await anchosDe(r)).join());
  check('el PDF resultante se puede volver a abrir', (await PDFDocument.load(r)).getPageCount() === 5);
}

console.log('\n3) Operaciones de la lista');
{
  const ps = lista('a', 5);
  check('eliminar varias', claves(removePages(ps, new Set(['a:0', 'a:4']))) === 'a:1 a:2 a:3');
  check('agregar sin elegir lugar = al final', claves(insertPagesAfter(ps, lista('b', 1), null)) === 'a:0 a:1 a:2 a:3 a:4 b:0');
  check('agregar después de la última', claves(insertPagesAfter(ps, lista('b', 1), 'a:4')) === 'a:0 a:1 a:2 a:3 a:4 b:0');
  check('agregar después de la primera', claves(insertPagesAfter(ps, lista('b', 1), 'a:0')) === 'a:0 b:0 a:1 a:2 a:3 a:4');
  check('arrastrar la 5 antes de la 1', claves(movePagesBefore(ps, ['a:4'], 'a:0')) === 'a:4 a:0 a:1 a:2 a:3');
  check('arrastrar dos juntas antes de la 2', claves(movePagesBefore(ps, ['a:3', 'a:4'], 'a:1')) === 'a:0 a:3 a:4 a:1 a:2');
  check('arrastrar al final', claves(movePagesBefore(ps, ['a:0'], null)) === 'a:1 a:2 a:3 a:4 a:0');
  check('soltar una página sobre sí misma no cambia nada', movePagesBefore(ps, ['a:2'], 'a:2') === ps);
  check('mover a la izquierda', claves(shiftPages(ps, new Set(['a:2']), -1)) === 'a:0 a:2 a:1 a:3 a:4');
  check('mover a la derecha', claves(shiftPages(ps, new Set(['a:2']), 1)) === 'a:0 a:1 a:3 a:2 a:4');
  check('la primera no se va más a la izquierda', claves(shiftPages(ps, new Set(['a:0']), -1)) === claves(ps));
  check('la última no se va más a la derecha', claves(shiftPages(ps, new Set(['a:4']), 1)) === claves(ps));
  check('dos seguidas se mueven juntas', claves(shiftPages(ps, new Set(['a:1', 'a:2']), 1)) === 'a:0 a:3 a:1 a:2 a:4');
  check('no modifica la lista original', claves(ps) === 'a:0 a:1 a:2 a:3 a:4');
}

console.log('\n4) Cosas que no deben pasar');
{
  let err = null;
  try { await buildEditedPdf(fuentes, []); } catch (e) { err = e; }
  check('no deja guardar un PDF sin páginas', !!err && /al menos una página/.test(err.message), err && err.message);
  err = null;
  try { await buildEditedPdf(fuentes, [{ docId: 'a', pageIndex: 9 }]); } catch (e) { err = e; }
  check('avisa si se pide una página que no existe', !!err, err && err.message);
  err = null;
  try { await buildEditedPdf(fuentes, [{ docId: 'zz', pageIndex: 0 }]); } catch (e) { err = e; }
  check('avisa si falta el PDF de origen', !!err, err && err.message);
  // La misma página dos veces (duplicar) es válido.
  const r = await buildEditedPdf(fuentes, [{ docId: 'a', pageIndex: 0 }, { docId: 'a', pageIndex: 0 }, { docId: 'b', pageIndex: 1 }, { docId: 'a', pageIndex: 0 }]);
  check('la misma página repetida y PDF alternados', (await anchosDe(r)).join() === '100,100,310,100', (await anchosDe(r)).join());
  // Los originales no se tocan.
  check('el PDF original sigue teniendo sus 5 páginas', (await PDFDocument.load(A)).getPageCount() === 5);
}

console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exitCode = fail ? 1 : 0;
