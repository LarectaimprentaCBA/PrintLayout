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

export const PAPER_PRESETS = [
  { id: 'a4', label: 'A4 (210×297)', w: 210, h: 297 },
  { id: 'a3', label: 'A3 (297×420)', w: 297, h: 420 },
  { id: 'a4l', label: 'A4 horizontal (297×210)', w: 297, h: 210 },
  { id: 'a3l', label: 'A3 horizontal (420×297)', w: 420, h: 297 },
];
