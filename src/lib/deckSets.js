// "Armar juegos": N frentes + M dorsos → J juegos, cada uno con UNA carta de cada
// frente. Devuelve la lista de cartas { front, back } en el orden en que van a
// las celdas (la arma useLayoutEditor.applyFrontBackPairs).
//
// Cómo se reparten los dorsos:
//   'perSet'  → cada juego lleva UN dorso, el mismo en todas sus cartas (juego 1
//               = dorso 1, juego 2 = dorso 2…). Si hay menos dorsos que juegos,
//               se van repitiendo en ronda.
//   'perCard' → los dorsos se reparten carta por carta, en ronda, a lo largo de
//               todos los juegos (dentro de un juego quedan dorsos distintos).

// Ordena por nombre "como una persona": "dorso 2" antes que "dorso 10".
export function sortByNameNatural(items) {
  const col = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
  return [...(items || [])].sort((a, b) => col.compare(String(a?.name ?? ''), String(b?.name ?? '')));
}

export function clampSets(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 0;
  return Math.min(500, v);
}

/**
 * PURO.
 * @param {object} p
 * @param {Array} p.fronts - imágenes de frente (una carta por cada una, en cada juego)
 * @param {Array} p.backs - imágenes de dorso (puede venir vacío: sale sin dorso)
 * @param {number} p.sets - cantidad de juegos
 * @param {'perSet'|'perCard'} [p.backMode]
 * @param {boolean} [p.newSheetPerSet] - cada juego arranca en hoja nueva
 * @param {number} [p.cellsPerPage] - lugares por hoja (para newSheetPerSet y el resumen)
 * @returns {{cards:Array<{front:any,back:any}>, realCards:number, sets:number, perSet:number,
 *            pages:number, backOfSet:Array<number|null>, backsUsed:number, backsUnused:number}}
 */
export function buildDeckSets({ fronts, backs, sets, backMode = 'perSet', newSheetPerSet = false, cellsPerPage = 0 }) {
  const F = Array.isArray(fronts) ? fronts.filter(Boolean) : [];
  const B = Array.isArray(backs) ? backs.filter(Boolean) : [];
  const J = clampSets(sets);
  const porHoja = Math.max(0, Math.floor(Number(cellsPerPage)) || 0);
  const vacio = { cards: [], realCards: 0, sets: J, perSet: F.length, pages: 0, backOfSet: [], backsUsed: 0, backsUnused: B.length };
  if (F.length === 0 || J === 0) return vacio;

  const cards = [];
  const backOfSet = [];
  const usados = new Set();
  let n = 0; // nº de carta real (para repartir carta por carta)
  for (let j = 0; j < J; j++) {
    if (newSheetPerSet && porHoja > 0) {
      // Rellenar con lugares vacíos hasta el comienzo de la próxima hoja.
      while (cards.length % porHoja !== 0) cards.push({ front: null, back: null });
    }
    const idxJuego = B.length ? j % B.length : null;
    backOfSet.push(backMode === 'perSet' ? idxJuego : null);
    for (let f = 0; f < F.length; f++) {
      const bi = B.length === 0 ? null : (backMode === 'perCard' ? n % B.length : idxJuego);
      if (bi !== null) usados.add(bi);
      cards.push({ front: F[f], back: bi === null ? null : B[bi] });
      n++;
    }
  }
  return {
    cards,
    realCards: n,
    sets: J,
    perSet: F.length,
    pages: porHoja > 0 ? Math.ceil(cards.length / porHoja) : 0,
    backOfSet,
    backsUsed: usados.size,
    backsUnused: B.length - usados.size,
  };
}
