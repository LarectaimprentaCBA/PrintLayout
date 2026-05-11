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

// Prueba la celda en ambas orientaciones (W x H y H x W) y devuelve la que
// rinde mas celdas. En empate prefiere la orientacion original (W x H).
export function computeBestGrid(params) {
  const direct = computeGrid(params);
  if (params.cellW === params.cellH) return direct;
  const rotated = computeGrid({
    ...params,
    cellW: params.cellH,
    cellH: params.cellW,
  });
  if (rotated.cells.length > direct.cells.length) return rotated;
  return direct;
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

export const PAPER_PRESETS = [
  { id: 'a4', label: 'A4 (210×297)', w: 210, h: 297 },
  { id: 'a3', label: 'A3 (297×420)', w: 297, h: 420 },
  { id: 'a4l', label: 'A4 horizontal (297×210)', w: 297, h: 210 },
  { id: 'a3l', label: 'A3 horizontal (420×297)', w: 420, h: 297 },
];
