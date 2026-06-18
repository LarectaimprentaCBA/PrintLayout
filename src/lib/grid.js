// Calculo de grillas uniformes para el modo "grilla rapida".

export function computeGrid({
  paperW,
  paperH,
  cellW,
  cellH,
  marginX = 0,
  marginY = 0,
  spacingX = 0,
  spacingY = 0,
}) {
  const usableW = paperW - 2 * marginX;
  const usableH = paperH - 2 * marginY;
  if (usableW <= 0 || usableH <= 0 || cellW <= 0 || cellH <= 0) {
    return { cells: [], cols: 0, rows: 0 };
  }
  // n columnas: n*cellW + (n-1)*spacingX <= usableW
  // => n <= (usableW + spacingX) / (cellW + spacingX)
  const cols = Math.max(0, Math.floor((usableW + spacingX) / (cellW + spacingX)));
  const rows = Math.max(0, Math.floor((usableH + spacingY) / (cellH + spacingY)));
  if (cols === 0 || rows === 0) {
    return { cells: [], cols, rows };
  }
  // Centrar la grilla horizontalmente y verticalmente sobre el area util.
  const totalGridW = cols * cellW + (cols - 1) * spacingX;
  const totalGridH = rows * cellH + (rows - 1) * spacingY;
  const startX = marginX + (usableW - totalGridW) / 2;
  const startY = marginY + (usableH - totalGridH) / 2;
  const cells = [];
  let id = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        id: id++,
        x: startX + c * (cellW + spacingX),
        y: startY + r * (cellH + spacingY),
        w: cellW,
        h: cellH,
      });
    }
  }
  return { cells, cols, rows };
}

// Prueba la celda en orientacion directa (W x H), rotada (H x W) o auto (la
// que rinda mas). En auto y empate, prefiere directa.
// rotateMode: 'auto' (default) | 'direct' | 'rotated'
// El resultado lleva `orientation: 'direct' | 'rotated'` para que la UI sepa
// cual se eligio realmente.
export function computeBestGrid(params, { rotateMode = 'auto' } = {}) {
  const direct = computeGrid(params);
  const square = params.cellW === params.cellH;

  if (rotateMode === 'direct' || square) {
    return { ...direct, orientation: 'direct' };
  }

  const rotatedParams = {
    ...params,
    cellW: params.cellH,
    cellH: params.cellW,
  };
  const rotated = computeGrid(rotatedParams);

  if (rotateMode === 'rotated') {
    return { ...rotated, orientation: 'rotated' };
  }

  // rotateMode === 'auto'
  if (rotated.cells.length > direct.cells.length) {
    return { ...rotated, orientation: 'rotated' };
  }
  return { ...direct, orientation: 'direct' };
}

// Reparte una lista de imageIds entre celdas objetivo de forma equitativa.
// - targetCellIndices: array<number> con los indices de celdas a llenar (orden ascendente).
// - imageIds: array<string> con los IDs de imagen en orden de carga.
//
// Algoritmo: cada imagen sale floor(N/K) veces; las primeras (N%K) imagenes
// salen una vez mas. Orden agrupado: A A A B B B C C C.
// Si imageIds.length > targetCellIndices.length, se usan solo las primeras
// targetCellIndices.length imagenes con 1 copia c/u.
//
// Retorna: Map<cellIdx, imageId>.
export function distributeEvenly(targetCellIndices, imageIds) {
  const result = new Map();
  const N = targetCellIndices.length;
  const K = imageIds.length;
  if (N === 0 || K === 0) return result;

  if (K >= N) {
    for (let i = 0; i < N; i++) {
      result.set(targetCellIndices[i], imageIds[i]);
    }
    return result;
  }

  const base = Math.floor(N / K);
  const extras = N % K;
  let cellPos = 0;
  for (let imgIdx = 0; imgIdx < K; imgIdx++) {
    const copies = imgIdx < extras ? base + 1 : base;
    for (let c = 0; c < copies; c++) {
      result.set(targetCellIndices[cellPos], imageIds[imgIdx]);
      cellPos += 1;
    }
  }
  return result;
}

// Dado un array de celdas (top-left origin, mm), devuelve polilineas rectangulares
// listas para guardar en template.cortes. Cada polilinea va clockwise y cerrada
// (primer punto repetido al final), mismo formato que produce parse_template.py
// para rectangulos vectoriales en la pagina de cortes.
//
// cutMarginMm achica el rectangulo de corte hacia adentro de la celda. Es decir,
// la imagen se imprime al tamano de la celda y la cuchilla corta cutMarginMm
// adentro en cada lado. Si la celda queda demasiado chica (<=0 en algun lado),
// se descarta.
export function cellsToCuts(cells, { cutMarginMm = 0 } = {}) {
  const m = Math.max(0, Number(cutMarginMm) || 0);
  const polylines = [];
  for (const c of cells) {
    const x0 = c.x + m;
    const y0 = c.y + m;
    const x1 = c.x + c.w - m;
    const y1 = c.y + c.h - m;
    if (x1 - x0 <= 0 || y1 - y0 <= 0) continue;
    polylines.push([
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ]);
  }
  return polylines;
}

// Como cellsToCuts pero genera circunferencias (sampleadas como polilineas).
// El circulo va inscripto en la celda y centrado; radio = min(w,h)/2 - margen.
// 64 segmentos = paso angular de 5.6 grados, suficiente para que el plotter
// haga la curva sin escalones visibles a tamano sticker.
export function cellsToCircleCuts(cells, { cutMarginMm = 0, segments = 64 } = {}) {
  const m = Math.max(0, Number(cutMarginMm) || 0);
  const polylines = [];
  for (const c of cells) {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const r = Math.min(c.w, c.h) / 2 - m;
    if (r <= 0) continue;
    const poly = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      poly.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    polylines.push(poly);
  }
  return polylines;
}

// Dispatcher: forma 'rect' (default) usa cellsToCuts, 'circle' usa cellsToCircleCuts.
export function generateCuts(cells, { cutShape = 'rect', cutMarginMm = 0 } = {}) {
  if (cutShape === 'circle') return cellsToCircleCuts(cells, { cutMarginMm });
  return cellsToCuts(cells, { cutMarginMm });
}

// Centra un conjunto de celdas dentro del area util de la hoja. Pensado para los
// "acomodar": cuando la ultima fila/columna queda incompleta, los disenos no
// quedan pegados arriba-izquierda sino centrados.
// - direction 'rows' (default): centra cada FILA (misma y) en horizontal y el
//   bloque entero en vertical. Asi una fila final con menos items queda centrada.
// - direction 'cols': centra cada COLUMNA (misma x) en vertical y el bloque en
//   horizontal.
// Muta las celdas (x/y) in place y las devuelve.
export function centerCellsInSheet(cells, {
  direction = 'rows',
  innerW,
  innerH,
  marginX = 0,
  marginY = 0,
  tol = 0.01,
} = {}) {
  if (!Array.isArray(cells) || cells.length === 0) return cells;

  const groupBy = (getKey) => {
    const groups = [];
    for (const c of cells) {
      const k = getKey(c);
      let g = groups.find((gr) => Math.abs(gr.key - k) < tol);
      if (!g) { g = { key: k, items: [] }; groups.push(g); }
      g.items.push(c);
    }
    return groups;
  };

  if (direction === 'cols') {
    for (const g of groupBy((c) => c.x)) {
      const minY = Math.min(...g.items.map((c) => c.y));
      const maxY = Math.max(...g.items.map((c) => c.y + c.h));
      const dy = marginY + (innerH - (maxY - minY)) / 2 - minY;
      for (const c of g.items) c.y += dy;
    }
    const minX = Math.min(...cells.map((c) => c.x));
    const maxX = Math.max(...cells.map((c) => c.x + c.w));
    const dx = marginX + (innerW - (maxX - minX)) / 2 - minX;
    for (const c of cells) c.x += dx;
  } else {
    for (const g of groupBy((c) => c.y)) {
      const minX = Math.min(...g.items.map((c) => c.x));
      const maxX = Math.max(...g.items.map((c) => c.x + c.w));
      const dx = marginX + (innerW - (maxX - minX)) / 2 - minX;
      for (const c of g.items) c.x += dx;
    }
    const minY = Math.min(...cells.map((c) => c.y));
    const maxY = Math.max(...cells.map((c) => c.y + c.h));
    const dy = marginY + (innerH - (maxY - minY)) / 2 - minY;
    for (const c of cells) c.y += dy;
  }
  return cells;
}

// Presets de hoja built-in (vienen con la app, no se pueden borrar ni editar).
// Los presets custom del usuario se cargan desde el store y se mergean en la UI.
export const BUILTIN_PAPER_PRESETS = [
  { id: 'a4', label: 'A4 (210×297)', w: 210, h: 297, builtin: true },
  { id: 'a3', label: 'A3 (297×420)', w: 297, h: 420, builtin: true },
  { id: 'a4l', label: 'A4 horizontal (297×210)', w: 297, h: 210, builtin: true },
  { id: 'a3l', label: 'A3 horizontal (420×297)', w: 420, h: 297, builtin: true },
];

// Alias retro-compat: codigo viejo que importe PAPER_PRESETS sigue funcionando
// con solo los presets built-in (el modal nuevo recibe la lista mergeada como prop).
export const PAPER_PRESETS = BUILTIN_PAPER_PRESETS;
