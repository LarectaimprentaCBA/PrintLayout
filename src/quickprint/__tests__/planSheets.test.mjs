// Armar las hojas de fotos SIN repetir trabajo.
//
// Pasó de verdad (06/11/2026): Mariano puso 2 fotos y 50 copias y la ventana
// tardaba una eternidad. Hojas distintas había DOS; la app armaba, comprimía,
// mandaba y corregía de color las 50, una por una. `planSheets` separa las
// hojas distintas del orden en que van, así cada una se arma una sola vez.
//
// Corre con: npm run test:plan-hojas

import { planSheets, paginate } from '../sheetRender.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};

// Lo que saldría por la impresora, hoja por hoja, según el plan.
const expandir = (plan) => plan.orden.map((i) => plan.distintas[i].join(','));
// Lo mismo calculado a la antigua, para comparar: fotos repetidas y paginadas.
const aLaAntigua = (nFotos, copias, porHoja) => {
  const plano = [];
  for (let i = 0; i < nFotos; i++) for (let c = 0; c < copias; c++) plano.push(i);
  return paginate(plano, porHoja).map((h) => h.join(','));
};

console.log('\n1) El caso de Mariano: 2 fotos × 50 copias, 2 por hoja');
{
  const p = planSheets(2, 50, 2);
  check('salen 50 hojas', p.orden.length === 50, String(p.orden.length));
  check('pero distintas hay solo DOS', p.distintas.length === 2, String(p.distintas.length));
  check('la primera es foto 1 y foto 1', p.distintas[0].join() === '0,0', p.distintas[0].join());
  check('la segunda es foto 2 y foto 2', p.distintas[1].join() === '1,1', p.distintas[1].join());
  check('sale lo mismo que antes', expandir(p).join('|') === aLaAntigua(2, 50, 2).join('|'));
}

console.log('\n2) Sale SIEMPRE lo mismo que antes (muchas combinaciones)');
{
  let iguales = 0, total = 0;
  for (let nFotos = 1; nFotos <= 7; nFotos++) {
    for (const copias of [1, 2, 3, 5, 12, 50, 99]) {
      for (const porHoja of [1, 2, 3, 4, 6, 8]) {
        total++;
        const a = expandir(planSheets(nFotos, copias, porHoja)).join('|');
        const b = aLaAntigua(nFotos, copias, porHoja).join('|');
        if (a === b) iguales++;
        else if (iguales === total - 1) console.log(`     primera diferencia: ${nFotos} fotos × ${copias} copias, ${porHoja}/hoja`);
      }
    }
  }
  check(`las ${total} combinaciones salen igual que antes`, iguales === total, `${iguales}/${total}`);
}

console.log('\n3) Cuánto trabajo se ahorra');
{
  // La última hoja suele ir incompleta, así que casi siempre hay una distinta
  // de más. Aun así se arman muchísimas menos que hojas salen.
  const casos = [
    [1, 50, 1, 1],   // 50 hojas iguales → se arma UNA
    [2, 50, 2, 2],   // el caso de Mariano
    [1, 99, 4, 2],   // 24 hojas de a 4 + una de 3
    [4, 10, 4, 6],
    [3, 7, 2, 5],
  ];
  for (const [nFotos, copias, porHoja, esperadas] of casos) {
    const p = planSheets(nFotos, copias, porHoja);
    check(`${nFotos} fotos × ${copias} copias, ${porHoja}/hoja → ${p.orden.length} hojas, ${p.distintas.length} para armar`,
      p.distintas.length === esperadas, `armaría ${p.distintas.length}, esperaba ${esperadas}`);
  }
}

console.log('\n4) Casos de borde');
{
  check('sin fotos no hay hojas', planSheets(0, 10, 2).orden.length === 0);
  check('1 foto y 1 copia = 1 hoja', planSheets(1, 1, 4).orden.length === 1);
  check('la última hoja puede ir incompleta',
    planSheets(3, 1, 2).distintas.map((h) => h.length).join() === '2,1',
    planSheets(3, 1, 2).distintas.map((h) => h.length).join());
  check('copias en 0 se trata como 1', planSheets(2, 0, 1).orden.length === 2);
  check('porHoja en 0 se trata como 1', planSheets(2, 1, 0).orden.length === 2);
  check('copias basura no rompe', planSheets(2, NaN, 2).orden.length === 1);
}

console.log('\n5) Las hojas distintas no comparten memoria entre sí');
{
  const p = planSheets(2, 2, 2);
  p.distintas[0][0] = 99;
  check('tocar una no cambia la otra', p.distintas[1][0] !== 99, String(p.distintas[1][0]));
}

console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exit(fail ? 1 : 0);
