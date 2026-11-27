// Planchas de TAGS: una hoja armada en Corel (los tags ya posados) a la que la
// app le pone las marcas, el QR y el logo del cliente en el dorso.
//
// El PDF trae 4 páginas del MISMO tamaño (= la hoja):
//   1. frente  (el arte de los tags, sin marcas)
//   2. dorso   (el arte fijo del dorso, tal como se imprime)
//   3. logos   (un rectángulo por cada lugar donde va el logo, sobre el dorso)
//   4. corte   (la silueta de cada tag y, si lo lleva, su agujero)
//
// Acá vive todo lo que es PURO (sin DOM ni pdf): qué corte es silueta y cuál es
// agujero, cómo queda el corte según se pida con o sin agujero, y los avisos de
// la plancha. Así se puede probar en node.

import { troquelCutForCell } from './grid.js';

const EPS = 0.05; // mm

export function isTagSheet(template) {
  return !!(template && template.tags && Array.isArray(template.tags.cortesBase));
}

function bboxOf(poly) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of poly || []) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]; const yi = poly[i][1];
    const xj = poly[j][0]; const yj = poly[j][1];
    if ((yi > py) !== (yj > py)
      && px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ¿`a` contiene a `b`? Tiene que ser claramente más grande (así dos cortes
// repetidos —Corel a veces exporta relleno + borde— no se "contienen" entre sí
// y ninguno se toma por agujero), envolverlo por caja y tener adentro el centro
// de la caja de `b`.
function contains(a, b) {
  if (a.poly.length < 3) return false;
  if (!(a.area > b.area * 1.05)) return false;
  if (b.box.x < a.box.x - EPS || b.box.y < a.box.y - EPS) return false;
  if (b.box.x + b.box.w > a.box.x + a.box.w + EPS) return false;
  if (b.box.y + b.box.h > a.box.y + a.box.h + EPS) return false;
  return pointInPoly(b.box.x + b.box.w / 2, b.box.y + b.box.h / 2, a.poly);
}

// Separa los cortes en PIEZAS: cada pieza es una silueta (corte que no está
// adentro de ningún otro) con sus cortes internos (agujeros). Devuelve
// [{ outer: idx, holes: [idx, ...], box }] en el orden del PDF.
export function classifyTagCuts(cortes) {
  const items = [];
  (cortes || []).forEach((poly, idx) => {
    const box = bboxOf(poly);
    if (!box) return;
    items.push({ idx, poly, box, area: box.w * box.h });
  });
  const parent = new Map();
  for (const b of items) {
    let best = null;
    for (const a of items) {
      if (a === b || !contains(a, b)) continue;
      // El dueño es la silueta de MÁS AFUERA (un corte adentro de un agujero
      // sigue siendo parte de la misma pieza).
      if (!best || a.area > best.area) best = a;
    }
    if (best) parent.set(b.idx, best.idx);
  }
  const pieces = [];
  const byOuter = new Map();
  for (const it of items) {
    if (parent.has(it.idx)) continue;
    const piece = { outer: it.idx, holes: [], box: it.box };
    byOuter.set(it.idx, piece);
    pieces.push(piece);
  }
  for (const it of items) {
    if (!parent.has(it.idx)) continue;
    const piece = byOuter.get(parent.get(it.idx));
    if (piece) piece.holes.push(it.idx);
  }
  return pieces;
}

// Resumen para mostrar: cuántos tags hay y cuántos traen el agujero dibujado.
export function tagSheetInfo(cortesBase) {
  const pieces = classifyTagCuts(cortesBase);
  const withHole = pieces.filter((p) => p.holes.length > 0).length;
  return {
    pieces: pieces.length,
    withHole,
    withoutHole: pieces.length - withHole,
    holes: pieces.reduce((s, p) => s + p.holes.length, 0),
  };
}

// Ajuste del agujero con el que arranca una plancha recién cargada: se corta si
// la plancha lo trae dibujado; si no lo trae, queda apagado (y al prenderlo la
// app agrega uno de 4 mm a 5 mm del borde de arriba, como en las grillas).
export function tagHoleDefaults(cortesBase) {
  const info = tagSheetInfo(cortesBase);
  return { cut: info.holes > 0, diameterMm: 4, fromTopMm: 5, dxMm: 0 };
}

export function normTagHole(hole) {
  const h = hole || {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    cut: h.cut === true,
    diameterMm: Math.max(0, num(h.diameterMm, 4)),
    fromTopMm: num(h.fromTopMm, 5),
    dxMm: num(h.dxMm, 0),
  };
}

// El corte que va al plotter según el ajuste del agujero.
//   · sin agujero  → solo las siluetas.
//   · con agujero  → por pieza, PRIMERO el/los agujeros y DESPUÉS la silueta (el
//     ojal se corta con el tag todavía sujeto a la hoja). Los tags que no lo
//     traen dibujado reciben uno redondo, ubicado desde el borde de arriba de
//     su silueta (mismo criterio que el troquel de las grillas).
export function buildTagCuts(cortesBase, hole) {
  const base = cortesBase || [];
  const h = normTagHole(hole);
  const out = [];
  for (const piece of classifyTagCuts(base)) {
    if (h.cut) {
      if (piece.holes.length > 0) {
        for (const i of piece.holes) out.push(base[i]);
      } else if (h.diameterMm > 0) {
        const circle = troquelCutForCell(piece.box, {
          diameterMm: h.diameterMm, fromTopMm: h.fromTopMm, dxMm: h.dxMm,
        });
        if (circle) out.push(circle);
      }
    }
    out.push(base[piece.outer]);
  }
  return out;
}

// Espeja en X (izquierda-derecha, giro tipo "libro"). Sirve para ver el corte
// sobre el dorso y para ubicar, en el frente, el lugar que cae detrás del logo.
export function mirrorCutsX(cortes, pageWidthMm) {
  return (cortes || []).map((poly) => poly.map(([x, y]) => [pageWidthMm - x, y]));
}

export function mirrorCellsX(cells, pageWidthMm) {
  return (cells || []).map((c, i) => ({
    id: c.id ?? i, x: pageWidthMm - c.x - c.w, y: c.y, w: c.w, h: c.h,
  }));
}

// Avisos de una plancha recién cargada (no bloquean: se muestran una vez).
export function checkTagSheet({
  cortesBase, celdasDorso, pageWidthMm, pageHeightMm, markMarginMm,
}) {
  const warnings = [];
  const pieces = classifyTagCuts(cortesBase);
  const W = pageWidthMm; const H = pageHeightMm;
  const m = Number(markMarginMm) || 0;

  // 1) Los tags tienen que quedar ADENTRO del rectángulo que forman las marcas
  //    (ahí lee y corta el plotter) y sin pisar los círculos de las esquinas.
  if (m > 0 && pieces.length > 0) {
    let fuera = 0; let enMarca = 0;
    const guard = 5; // radio del resguardo blanco de la marca (4,5 mm) + aire
    const corners = [[m, m], [W - m, m], [m, H - m], [W - m, H - m]];
    for (const p of pieces) {
      const b = p.box;
      if (b.x < m - EPS || b.y < m - EPS || b.x + b.w > W - m + EPS || b.y + b.h > H - m + EPS) {
        fuera++;
        continue;
      }
      for (const [cx, cy] of corners) {
        const nx = Math.max(b.x, Math.min(cx, b.x + b.w));
        const ny = Math.max(b.y, Math.min(cy, b.y + b.h));
        if (Math.hypot(nx - cx, ny - cy) < guard) { enMarca++; break; }
      }
    }
    if (fuera > 0) {
      warnings.push(
        `${fuera} tag${fuera === 1 ? ' queda' : 's quedan'} a menos de ${m} mm del borde de la hoja: ahí van las marcas y el plotter no corta. Corré los tags hacia adentro o imprimí en una hoja más grande ("Tamaño de hoja").`,
      );
    }
    if (enMarca > 0) {
      warnings.push(
        `${enMarca} tag${enMarca === 1 ? ' pisa' : 's pisan'} una marca de las esquinas. Dejá libres las cuatro esquinas.`,
      );
    }
  }

  // 2) Cada recuadro de logo tiene que caer detrás de un tag. El corte está
  //    dibujado mirando el frente; visto desde el dorso queda espejado.
  const cajas = celdasDorso || [];
  if (cajas.length > 0 && pieces.length > 0) {
    const dentro = (box, c) => {
      const cx = c.x + c.w / 2; const cy = c.y + c.h / 2;
      return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
    };
    const espejadas = pieces.map((p) => ({ ...p.box, x: W - p.box.x - p.box.w }));
    const sueltas = cajas.filter((c) => !espejadas.some((b) => dentro(b, c))).length;
    if (sueltas > 0) {
      const sinEspejar = cajas.filter((c) => !pieces.some((p) => dentro(p.box, c))).length;
      warnings.push(
        sinEspejar === 0
          ? 'El dorso parece armado SIN espejar: los recuadros del logo coinciden con los tags del frente, pero al dar vuelta la hoja caen del otro lado. En Corel, espejá el dorso entero (los tags de la izquierda pasan a la derecha) dejando los textos derechos.'
          : `${sueltas} recuadro${sueltas === 1 ? '' : 's'} de logo no cae${sueltas === 1 ? '' : 'n'} detrás de ningún tag. Revisá la página 3 del PDF.`,
      );
    }
  }
  return warnings;
}
