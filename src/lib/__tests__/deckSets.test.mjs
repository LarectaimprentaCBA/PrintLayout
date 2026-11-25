// "Armar juegos": frentes + dorsos → juegos de cartas.
// Corre con: npm run test:armar-juegos
import { buildDeckSets, sortByNameNatural, clampSets } from '../deckSets.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};
const img = (pref, n) => Array.from({ length: n }, (_, i) => ({ id: `${pref}${i + 1}`, name: `${pref} ${i + 1}.png` }));
const cuenta = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); m.set(k, (m.get(k) || 0) + 1); } return m; };

console.log('\n1) El pedido: 14 frentes, 20 dorsos, 20 juegos (un dorso por juego)');
{
  const F = img('f', 14), B = img('d', 20);
  const r = buildDeckSets({ fronts: F, backs: B, sets: 20, cellsPerPage: 9 });
  check('salen 280 cartas', r.cards.length === 280 && r.realCards === 280, String(r.cards.length));
  check('20 juegos de 14', r.sets === 20 && r.perSet === 14);
  let okJuegos = true, okDorso = true;
  for (let j = 0; j < 20; j++) {
    const juego = r.cards.slice(j * 14, j * 14 + 14);
    if (juego.map((c) => c.front.id).join() !== F.map((x) => x.id).join()) okJuegos = false;
    if (!juego.every((c) => c.back === B[j])) okDorso = false;
  }
  check('cada juego tiene UNA de cada frente, en orden', okJuegos);
  check('el juego N lleva el dorso N en todas sus cartas', okDorso);
  const porFrente = cuenta(r.cards, (c) => c.front.id), porDorso = cuenta(r.cards, (c) => c.back.id);
  check('cada frente sale 20 veces', [...porFrente.values()].every((v) => v === 20) && porFrente.size === 14);
  check('cada dorso sale 14 veces', [...porDorso.values()].every((v) => v === 14) && porDorso.size === 20);
  check('32 hojas de 9', r.pages === 32, String(r.pages));
  check('se usan los 20 dorsos, no sobra ninguno', r.backsUsed === 20 && r.backsUnused === 0);
  check('lista de qué dorso lleva cada juego', r.backOfSet.join() === Array.from({ length: 20 }, (_, i) => i).join());
}

console.log('\n2) Menos dorsos que juegos / más dorsos que juegos / sin dorsos');
{
  const F = img('f', 3);
  const r = buildDeckSets({ fronts: F, backs: img('d', 2), sets: 5 });
  check('5 juegos con 2 dorsos: se repiten en ronda (1,2,1,2,1)', r.backOfSet.join() === '0,1,0,1,0', r.backOfSet.join());
  check('…y dentro de cada juego el dorso es uno solo', [0, 1, 2, 3, 4].every((j) => new Set(r.cards.slice(j * 3, j * 3 + 3).map((c) => c.back.id)).size === 1));
  const s = buildDeckSets({ fronts: F, backs: img('d', 6), sets: 4 });
  check('6 dorsos y 4 juegos: se usan 4, sobran 2 (y se avisa)', s.backsUsed === 4 && s.backsUnused === 2);
  const n = buildDeckSets({ fronts: F, backs: [], sets: 2 });
  check('sin dorsos: salen las cartas con el dorso vacío', n.cards.length === 6 && n.cards.every((c) => c.back === null && c.front));
  const u = buildDeckSets({ fronts: F, backs: img('d', 1), sets: 3 });
  check('un solo dorso: todos los juegos con ese', u.cards.every((c) => c.back.id === 'd1'));
}

console.log('\n3) Dorsos repartidos carta por carta');
{
  const F = img('f', 14), B = img('d', 20);
  const r = buildDeckSets({ fronts: F, backs: B, sets: 20, backMode: 'perCard' });
  const porDorso = cuenta(r.cards, (c) => c.back.id);
  check('280 cartas, cada dorso 14 veces', r.cards.length === 280 && [...porDorso.values()].every((v) => v === 14) && porDorso.size === 20);
  check('cada juego sigue teniendo una de cada frente', r.cards.slice(14, 28).map((c) => c.front.id).join() === F.map((x) => x.id).join());
  check('dentro de un juego los dorsos son distintos', new Set(r.cards.slice(0, 14).map((c) => c.back.id)).size === 14);
  check('van en ronda: la carta 21 vuelve al dorso 1', r.cards[20].back.id === 'd1' && r.cards[0].back.id === 'd1' && r.cards[19].back.id === 'd20');
}

console.log('\n4) Cada juego en hoja nueva');
{
  const F = img('f', 14), B = img('d', 20);
  const r = buildDeckSets({ fronts: F, backs: B, sets: 20, cellsPerPage: 9, newSheetPerSet: true });
  check('cada juego ocupa 2 hojas: 40 hojas', r.pages === 40, String(r.pages));
  check('siguen siendo 280 cartas de verdad', r.realCards === 280 && r.cards.filter((c) => c.front).length === 280);
  let ok = true;
  for (let j = 0; j < 20; j++) if (r.cards[j * 18]?.front?.id !== 'f1' || r.cards[j * 18].back.id !== `d${j + 1}`) ok = false;
  check('cada juego arranca en el primer lugar de una hoja', ok);
  check('los lugares que sobran quedan vacíos (frente y dorso)', r.cards[14].front === null && r.cards[14].back === null && r.cards[17].front === null);
  const justo = buildDeckSets({ fronts: img('f', 9), backs: B, sets: 3, cellsPerPage: 9, newSheetPerSet: true });
  check('si el juego llena justo la hoja no deja hojas vacías', justo.cards.length === 27 && justo.pages === 3);
  const sinDato = buildDeckSets({ fronts: F, backs: B, sets: 2, cellsPerPage: 0, newSheetPerSet: true });
  check('sin saber cuántas entran por hoja: no rompe', sinDato.cards.length === 28 && sinDato.pages === 0);
}

console.log('\n5) Datos raros');
{
  check('sin frentes: nada', buildDeckSets({ fronts: [], backs: img('d', 3), sets: 5 }).cards.length === 0);
  check('0 juegos: nada', buildDeckSets({ fronts: img('f', 3), backs: [], sets: 0 }).cards.length === 0);
  check('juegos con texto o vacío: nada', buildDeckSets({ fronts: img('f', 3), backs: [], sets: 'abc' }).cards.length === 0 && buildDeckSets({ fronts: img('f', 3), sets: '' }).cards.length === 0);
  check('"20" escrito como texto vale', buildDeckSets({ fronts: img('f', 2), backs: [], sets: '20' }).cards.length === 40);
  check('tope de 500 juegos', clampSets(99999) === 500 && clampSets(2.9) === 2 && clampSets(-3) === 0);
  check('listas con huecos (null) se ignoran', buildDeckSets({ fronts: [null, ...img('f', 2)], backs: [null], sets: 1 }).cards.length === 2);
  const ord = sortByNameNatural([{ name: 'dorso 10.png' }, { name: 'dorso 2.png' }, { name: 'Dorso 1.png' }]).map((x) => x.name).join('|');
  check('orden por nombre: 1, 2, 10 (no 1, 10, 2)', ord === 'Dorso 1.png|dorso 2.png|dorso 10.png', ord);
}

console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exitCode = fail ? 1 : 0;
