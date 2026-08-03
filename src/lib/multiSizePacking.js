// Empaquetado de piezas de MEDIDAS MÚLTIPLES en una o varias hojas.
//
// A diferencia de imagePacking.js (todas las piezas comparten una dimensión
// fija), acá cada pieza puede tener su propio ancho×alto. Se usa para armar una
// plantilla con casilleros de distintos tamaños ("3 de 10×15 + 2 de 5×7…"),
// empaquetados apretado MEZCLANDO medidas, rotando piezas cuando conviene para
// aprovechar la hoja, y abriendo hojas nuevas cuando no entran.
//
// Algoritmo: shelf packing (First-Fit Decreasing Height). Simple, rápido y da
// buenos resultados mezclando tamaños: cada "estante" (fila) toma piezas de
// anchos variados mientras entren en su alto y en el ancho restante.

export function packMultiSizePieces({
  pieces,            // [{ w, h, rotatable }]  medidas en mm
  paperW, paperH,    // mm
  marginX = 5,
  marginY = 5,
  spacingX = 2,
  spacingY = 2,
  allowRotate = true,
  maxPages = 200,
  // Franja libre al pie de cada hoja (para el QR de corte, que va abajo y no
  // debe pisar los casilleros). Reduce el alto útil desde abajo.
  bottomReserveMm = 0,
  // Franja libre ARRIBA (simétrica a la de abajo en doble faz, para centrar y
  // que el QR quede con espacio parejo). Reduce el alto útil desde arriba.
  topReserveMm = 0,
}) {
  const botR = Math.max(0, Number(bottomReserveMm) || 0);
  const topR = Math.max(0, Number(topReserveMm) || 0);
  const yTop = marginY + topR;                    // límite superior útil
  const yBottom = paperH - marginY - botR;        // límite inferior útil
  const innerW = paperW - 2 * marginX;
  const innerH = yBottom - yTop;

  if (innerW <= 0 || innerH <= 0 || !Array.isArray(pieces) || pieces.length === 0) {
    return { pages: [], pageCount: 0, placed: 0, skipped: pieces?.length || 0, total: pieces?.length || 0 };
  }

  // Orden por dimensión mayor descendente (FFDH): mete primero las piezas
  // grandes, que son las que más condicionan el empaquetado.
  const order = pieces
    .map((p, idx) => ({ ...p, idx }))
    .sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));

  // Orientaciones candidatas de una pieza que ENTRAN en la hoja. Si rota, se
  // agrega la girada 90°. Se prueba la orientación pedida primero.
  const orientations = (p) => {
    const list = [[p.w, p.h]];
    if (allowRotate && p.rotatable !== false && Math.abs(p.w - p.h) > 0.01) {
      list.push([p.h, p.w]);
    }
    return list.filter(([w, h]) => w <= innerW + 0.01 && h <= innerH + 0.01);
  };

  const pages = []; // cada hoja: { shelves: [{ x, y, h }], nextY }
  const cells = []; // { x, y, w, h, page }

  const placeOnPage = (page, pageIdx, p) => {
    const cands = orientations(p);
    if (!cands.length) return false;
    // 1) Probar estantes existentes (reusar filas ya abiertas = más apretado).
    for (const [w, h] of cands) {
      for (const sh of page.shelves) {
        if (h <= sh.h + 0.01 && sh.x + w <= marginX + innerW + 0.01) {
          cells.push({ x: sh.x, y: sh.y, w, h, page: pageIdx, ref: p.ref, shape: p.shape });
          sh.x += w + spacingX;
          return true;
        }
      }
    }
    // 2) Abrir un estante nuevo abajo si hay alto disponible.
    for (const [w, h] of cands) {
      if (page.nextY + h <= yBottom + 0.01) {
        cells.push({ x: marginX, y: page.nextY, w, h, page: pageIdx, ref: p.ref, shape: p.shape });
        page.shelves.push({ x: marginX + w + spacingX, y: page.nextY, h });
        page.nextY = page.nextY + h + spacingY;
        return true;
      }
    }
    return false;
  };

  for (const p of order) {
    if (!orientations(p).length) continue; // no entra ni sola: se descarta abajo
    let placed = false;
    for (let pi = 0; pi < pages.length; pi++) {
      if (placeOnPage(pages[pi], pi, p)) { placed = true; break; }
    }
    if (!placed && pages.length < maxPages) {
      const page = { shelves: [], nextY: yTop };
      pages.push(page);
      placed = placeOnPage(page, pages.length - 1, p);
    }
  }

  const pageCount = pages.length;
  const skipped = pieces.length - cells.length;
  const pagesCells = [];
  for (let p = 0; p < pageCount; p++) {
    pagesCells.push(cells.filter((c) => c.page === p));
  }

  return { pages: pagesCells, pageCount, placed: cells.length, skipped, total: pieces.length };
}

// "Repartir parejo el sobrante": parte de las cantidades pedidas y va SUMANDO
// piezas de más —una por tipo, en ronda (round-robin) para que quede parejo—
// mientras el sobrante de la(s) hoja(s) las banque SIN abrir hojas nuevas ni
// dejar ninguna afuera. Devuelve el resultado ya empaquetado y las cantidades
// finales por fila (para mostrar "10 → 13"). No toca la cantidad de hojas: solo
// aprovecha el espacio que ya iba a quedar vacío.
//
// recipe: [{ w, h, qty, orient, shape }] (mismas filas que ve el usuario).
// packParams: el resto de parámetros de packMultiSizePieces (paperW/H, márgenes…).
export function fillRecipeEvenly(recipe, packParams) {
  const rows = (recipe || []).map((r) => {
    const shape = r.shape === 'circle' ? 'circle' : 'rect';
    return {
      w: shape === 'circle' ? Number(r.w) : Number(r.w),
      h: shape === 'circle' ? Number(r.w) : Number(r.h),
      qty: Math.max(0, Math.floor(Number(r.qty) || 0)),
      orient: r.orient,
      shape,
    };
  });
  const counts = rows.map((r) => r.qty);
  const build = (cs) => {
    const pieces = [];
    rows.forEach((r, i) => {
      if (!(r.w > 0) || !(r.h > 0)) return;
      const rotatable = r.shape === 'circle' ? false : (r.orient ?? 'auto') === 'auto';
      for (let k = 0; k < cs[i]; k++) pieces.push({ w: r.w, h: r.h, rotatable, shape: r.shape });
    });
    return pieces;
  };

  let result = packMultiSizePieces({ ...packParams, pieces: build(counts) });
  const baseline = result.pageCount;
  // Si con lo pedido no entra todo (ya hay descartes) o no hay hojas, no hay
  // sobrante que repartir: devolvemos tal cual.
  if (baseline === 0 || result.skipped > 0) return { result, counts };

  // Solo rellenamos filas válidas y con al menos 1 pedida (respetar "0 de esto").
  const exhausted = rows.map((r, i) => !(r.w > 0) || !(r.h > 0) || counts[i] <= 0);
  let anyActive = exhausted.some((e) => !e);
  // Cota de seguridad por si algo raro impide converger.
  let guard = 100000;
  while (anyActive && guard-- > 0) {
    anyActive = false;
    for (let i = 0; i < rows.length; i++) {
      if (exhausted[i]) continue;
      const trial = counts.slice();
      trial[i] += 1;
      const res = packMultiSizePieces({ ...packParams, pieces: build(trial) });
      if (res.pageCount <= baseline && res.skipped === 0) {
        counts[i] = trial[i];
        result = res;
        anyActive = true;
      } else {
        exhausted[i] = true; // esta medida ya no entra más: la sacamos de la ronda
      }
    }
  }
  return { result, counts };
}

// Expande una receta [{ w, h, qty, orient, shape }] a la lista plana de piezas
// para el packer. orient: 'auto' (rota), 'fija' (como la pusiste, sin rotar).
// shape: 'circle' → casillero redondo (cuadrado de lado = diámetro, no rota).
export function recipeToPieces(recipe) {
  const pieces = [];
  for (const row of recipe || []) {
    const shape = row.shape === 'circle' ? 'circle' : 'rect';
    // En círculo la medida es un diámetro: cuadrado de lado = diámetro.
    const w = shape === 'circle' ? Number(row.w) : Number(row.w);
    const h = shape === 'circle' ? Number(row.w) : Number(row.h);
    const qty = Math.max(0, Math.floor(Number(row.qty) || 0));
    if (!(w > 0) || !(h > 0) || qty <= 0) continue;
    const rotatable = shape === 'circle' ? false : (row.orient ?? 'auto') === 'auto';
    for (let i = 0; i < qty; i++) pieces.push({ w, h, rotatable, shape });
  }
  return pieces;
}
