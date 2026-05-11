// Modelo de plantilla:
// {
//   id, name, createdAt, updatedAt,
//   pdfBase64,                         // PDF original entero
//   pageWidthMm, pageHeightMm,
//   pageCount,                         // 2 o 3
//   celdas: [{ id, x, y, w, h }],      // mm, origen top-left
//   cortes: [[[x_mm, y_mm], ...]],     // polilineas, mm top-left (vacio si no hay pag 3)
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

export function cellPositions(template, face = 'front') {
  if (!template) return [];
  if (face === 'back' && Array.isArray(template.celdasDorso)
      && template.celdasDorso.length > 0) {
    return template.celdasDorso;
  }
  return template.celdas ?? [];
}

// Celdas de una pagina especifica (segun el modelo de la plantilla).
export function cellsForPage(template, pageIdx, face = 'front') {
  if (!template) return [];
  if (isMultiPage(template)) {
    const p = template.pages[pageIdx];
    if (!p) return [];
    if (face === 'back' && Array.isArray(p.celdasDorso) && p.celdasDorso.length > 0) {
      return p.celdasDorso;
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
