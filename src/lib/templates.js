// Modelo de plantilla:
// {
//   id, name, createdAt, updatedAt,
//   pdfBase64,                         // PDF original entero
//   pageWidthMm, pageHeightMm,
//   pageCount,                         // 2 o 3
//   celdas: [{ id, x, y, w, h }],      // mm, origen top-left
//   cortes: [[[x_mm, y_mm], ...]],     // polilineas, mm top-left (vacio si no hay pag 3)
//   cellWhiteBorderMm,                 // borde blanco parejo de la foto dentro de
//                                      // cada celda (mm). El corte NO cambia: la foto
//                                      // se achica hacia adentro. 0/ausente = sin borde.
//
//   // Multi-page templates (auto-pack con overflow):
//   pages: [{ celdas: [...], celdasDorso?: [...] }, ...],
//     // Cuando esta presente, celdas de la plantilla se ignoran y cada pagina
//     // tiene sus propias celdas. pageCount logico = pages.length, sin auto
//     // paginacion. Si esta vacio o ausente, se usa celdas/celdasDorso como
//     // antes (mismas celdas en todas las hojas, paginas crecen dinamicamente).
// }

function isMultiPage(template) {
  return Array.isArray(template?.pages) && template.pages.length > 0;
}

// Cantidad TOTAL de celdas. Para multi-page suma todas; para legacy es solo
// las de una pagina (la cantidad de hojas viene del estado de assignments).
export function totalCells(template) {
  if (isMultiPage(template)) {
    return template.pages.reduce((s, p) => s + (p?.celdas?.length ?? 0), 0);
  }
  return template?.celdas?.length ?? 0;
}

// Cantidad de celdas en una hoja especifica. Para multi-page mira pages[p];
// para legacy es siempre celdas (las paginas son virtuales).
export function cellsCountOnPage(template, pageIdx, face = 'front') {
  if (!template) return 0;
  if (isMultiPage(template)) {
    const p = template.pages[pageIdx];
    if (!p) return 0;
    if (face === 'back' && Array.isArray(p.celdasDorso) && p.celdasDorso.length > 0) {
      return p.celdasDorso.length;
    }
    return p.celdas?.length ?? 0;
  }
  return cellPositions(template, face).length;
}

// Indice del primer cell en la pagina dada dentro del array flat de assignments.
export function pageStartOffset(template, pageIdx, face = 'front') {
  if (!template) return 0;
  if (isMultiPage(template)) {
    let s = 0;
    for (let i = 0; i < pageIdx; i++) {
      s += cellsCountOnPage(template, i, face);
    }
    return s;
  }
  return pageIdx * cellPositions(template, face).length;
}

// Numero fijo de paginas para multi-page; null para legacy (donde depende
// del estado de assignments).
export function fixedPageCount(template) {
  return isMultiPage(template) ? template.pages.length : null;
}

// Dado un indice flat en assignments, devuelve { page, localIdx, pageSize }.
// Legacy: cellsPerPage es constante (celdas.length). Multi-page: cada hoja
// puede tener distinta cantidad.
export function findCellPageInfo(template, flatIdx, face = 'front') {
  if (!template) return { page: 0, localIdx: 0, pageSize: 0 };
  if (isMultiPage(template)) {
    let s = 0;
    for (let p = 0; p < template.pages.length; p++) {
      const count = cellsCountOnPage(template, p, face);
      if (flatIdx < s + count) {
        return { page: p, localIdx: flatIdx - s, pageSize: count };
      }
      s += count;
    }
    const last = template.pages.length - 1;
    return {
      page: Math.max(0, last),
      localIdx: 0,
      pageSize: cellsCountOnPage(template, last, face),
    };
  }
  const cellsPP = cellPositions(template, face).length;
  if (cellsPP === 0) return { page: 0, localIdx: 0, pageSize: 0 };
  return {
    page: Math.floor(flatIdx / cellsPP),
    localIdx: flatIdx % cellsPP,
    pageSize: cellsPP,
  };
}

export function hasCuts(template) {
  return Array.isArray(template?.cortes) && template.cortes.length > 0;
}

// Eje de espejado del dorso. Posicion y rotacion del dorso son INDEPENDIENTES:
//  - backMirror 'x' => espejo izquierda-derecha (x -> W - x - w).
//  - backMirror 'y' => espejo arriba-abajo (y -> H - y - h).  [default]
// Compat: plantillas viejas con backFlip ('tb'|'lr') se mapean ('lr' -> 'x').
export function backMirrorAxis(template) {
  if (template?.backMirror === 'x' || template?.backMirror === 'y') {
    return template.backMirror;
  }
  return template?.backFlip === 'lr' ? 'x' : 'y';
}

// Si el dorso debe rotar 180° su contenido (independiente del espejo).
// Compat: el modo viejo 'tb' rotaba; 'lr' no.
export function backRotate180(template) {
  if (typeof template?.backRotate180 === 'boolean') return template.backRotate180;
  return template?.backFlip != null && template.backFlip !== 'lr';
}

// Espeja una lista de celdas del frente para obtener las del dorso. Mantiene el
// mismo orden/id, asi el dorso de la tarjeta i sigue emparejado con su frente i
// y cae fisicamente detras al girar la hoja.
export function mirrorCellsForBack(cells, pageWidthMm, pageHeightMm, axis) {
  if (!Array.isArray(cells)) return [];
  const mirrorX = axis === 'x';
  const W = pageWidthMm;
  const H = pageHeightMm;
  return cells.map((c) => ({
    id: c.id,
    x: mirrorX ? W - c.x - c.w : c.x,
    y: mirrorX ? c.y : H - c.y - c.h,
    w: c.w,
    h: c.h,
  }));
}

export function cellPositions(template, face = 'front') {
  if (!template) return [];
  if (face === 'back') {
    // Dorso con celdas propias (plantillas que ya traen su layout de dorso).
    if (Array.isArray(template.celdasDorso) && template.celdasDorso.length > 0) {
      return template.celdasDorso;
    }
    // Doble faz sin dorso propio: derivamos el dorso espejando el frente segun
    // el eje elegido. Asi cada celda del dorso cae detras de su par del frente
    // sin tener que guardar un layout aparte.
    if (template.doubleSided && Array.isArray(template.celdas) && template.celdas.length > 0) {
      return mirrorCellsForBack(
        template.celdas,
        template.pageWidthMm,
        template.pageHeightMm,
        backMirrorAxis(template),
      );
    }
  }
  return template.celdas ?? [];
}

// Celdas de una pagina especifica (segun el modelo de la plantilla).
export function cellsForPage(template, pageIdx, face = 'front') {
  if (!template) return [];
  if (isMultiPage(template)) {
    const p = template.pages[pageIdx];
    if (!p) return [];
    if (face === 'back') {
      // Dorso propio de la pagina, si lo trae.
      if (Array.isArray(p.celdasDorso) && p.celdasDorso.length > 0) {
        return p.celdasDorso;
      }
      // Doble faz sin dorso propio: espejamos las celdas del frente de ESTA
      // pagina (igual criterio que cellPositions, para que editor y PDF
      // coincidan tambien en multi-page).
      if (template.doubleSided && Array.isArray(p.celdas) && p.celdas.length > 0) {
        return mirrorCellsForBack(
          p.celdas,
          template.pageWidthMm,
          template.pageHeightMm,
          backMirrorAxis(template),
        );
      }
    }
    return p.celdas ?? [];
  }
  return cellPositions(template, face);
}

export function hasCustomBackCells(template) {
  return Array.isArray(template?.celdasDorso) && template.celdasDorso.length > 0;
}

// Orientacion target de la plantilla: tomamos la primera celda (asumimos
// que las plantillas tienen celdas todas con la misma orientacion, que es
// el caso comun: Polaroid vertical, tarjetas horizontal, etc).
// Devuelve 'portrait' | 'landscape' | 'square' | null si no hay celdas.
export function templateOrientation(template) {
  const cell = template?.celdas?.[0];
  if (!cell) return null;
  if (cell.w > cell.h) return 'landscape';
  if (cell.h > cell.w) return 'portrait';
  return 'square';
}

// Orientacion de una imagen.
export function imageOrientation(image) {
  if (!image) return null;
  if (image.width > image.height) return 'landscape';
  if (image.height > image.width) return 'portrait';
  return 'square';
}

// Bounding box de una polilinea de corte.
function polyBBox(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of poly) {
    const x = pt[0], y = pt[1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function polyCentroid(poly) {
  let sx = 0, sy = 0, n = 0;
  for (const pt of poly) { sx += pt[0]; sy += pt[1]; n++; }
  return n > 0 ? { x: sx / n, y: sy / n } : null;
}

function pointInRect(pt, rect) {
  return pt.x >= rect.x && pt.x <= rect.x + rect.w
      && pt.y >= rect.y && pt.y <= rect.y + rect.h;
}

// Devuelve el rect de corte (en mm, top-left origin) asociado a una celda.
//
// Estrategia:
//   1. Primero busca polilineas cuyo centroide caiga DENTRO de la celda
//      (caso tipico: el corte esta interior, la celda incluye sangrado).
//   2. Si no hay, busca el centroide mas cercano al centro de la celda dentro
//      de un radio = max(cell.w, cell.h). Esto cubre cortes ligeramente fuera.
//   3. Si nada match, devuelve null.
//
// Si hay multiples polilineas candidatas, devuelve la de mayor area (caso
// PDFs con marcas de corte redundantes).
export function cutRectForCell(template, cell) {
  if (!template || !cell) return null;
  const cortes = template.cortes ?? [];
  if (cortes.length === 0) return null;
  const inside = [];
  for (const poly of cortes) {
    const bb = polyBBox(poly);
    const c = polyCentroid(poly);
    if (!bb || !c) continue;
    if (pointInRect(c, cell)) inside.push(bb);
  }
  if (inside.length > 0) {
    inside.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    return inside[0];
  }
  // Fallback: el corte mas cercano dentro de un radio razonable.
  const cellCx = cell.x + cell.w / 2;
  const cellCy = cell.y + cell.h / 2;
  const maxR = Math.max(cell.w, cell.h);
  let best = null;
  let bestDist = Infinity;
  for (const poly of cortes) {
    const bb = polyBBox(poly);
    const c = polyCentroid(poly);
    if (!bb || !c) continue;
    const d = Math.hypot(c.x - cellCx, c.y - cellCy);
    if (d < bestDist && d < maxR) {
      bestDist = d;
      best = bb;
    }
  }
  return best;
}

// Bleed por lado en mm. Positivo = el corte esta INTERIOR (la celda incluye
// sangrado); negativo = el corte esta FUERA (la imagen impresa excede la
// celda). Devuelve null si no se detecta corte para esa celda.
export function bleedMmForCell(template, cell) {
  if (!template || !cell) return null;
  const cut = cutRectForCell(template, cell);
  if (!cut) return null;
  return {
    top: cut.y - cell.y,
    right: (cell.x + cell.w) - (cut.x + cut.w),
    bottom: (cell.y + cell.h) - (cut.y + cut.h),
    left: cut.x - cell.x,
  };
}

// Zona segura interior al corte, en mm. Sale de template.safetyMm si esta;
// default 3 mm.
export function safetyMm(template) {
  const v = parseFloat(template?.safetyMm);
  return Number.isFinite(v) && v >= 0 ? v : 3;
}

// Devuelve true si la primera celda y todas las restantes tienen el mismo
// tamano. El editor lo usa para saber si puede tomar la primera celda como
// referencia universal (caso comun en plantillas de tarjetas).
export function cellsHomogeneous(template) {
  const cells = template?.celdas ?? [];
  if (cells.length === 0) return false;
  const ref = cells[0];
  const EPS = 0.1;
  return cells.every(
    (c) => Math.abs(c.w - ref.w) < EPS && Math.abs(c.h - ref.h) < EPS,
  );
}

// Para mostrar en la sidebar, agrupamos celdas en filas para describir la
// distribución sin pretender que sea una grilla regular.
export function describeCells(template) {
  if (isMultiPage(template)) {
    const c = totalCells(template);
    const p = template.pages.length;
    return `${c} celda${c === 1 ? '' : 's'} · ${p} hoja${p === 1 ? '' : 's'}`;
  }
  const c = totalCells(template);
  if (!c) return 'sin celdas';
  return `${c} celda${c === 1 ? '' : 's'}`;
}
