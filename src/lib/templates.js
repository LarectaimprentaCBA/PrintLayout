// Modelo de plantilla:
// {
//   id, name, createdAt, updatedAt,
//   pdfBase64,                         // PDF original entero
//   pageWidthMm, pageHeightMm,
//   pageCount,                         // 2 o 3
//   celdas: [{ id, x, y, w, h }],      // mm, origen top-left
//   cortes: [[[x_mm, y_mm], ...]],     // polilineas, mm top-left (vacio si no hay pag 3)
// }

export function totalCells(template) {
  return template?.celdas?.length ?? 0;
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

export function hasCustomBackCells(template) {
  return Array.isArray(template?.celdasDorso) && template.celdasDorso.length > 0;
}

// Para mostrar en la sidebar, agrupamos celdas en filas para describir la
// distribución sin pretender que sea una grilla regular.
export function describeCells(template) {
  const c = totalCells(template);
  if (!c) return 'sin celdas';
  return `${c} celda${c === 1 ? '' : 's'}`;
}
