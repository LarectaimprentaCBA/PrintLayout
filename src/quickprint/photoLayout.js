// Acomodado de fotos en la hoja, estilo "Imprimir imágenes" de Windows:
// entran las que quepan del tamaño elegido, probando las dos orientaciones de la
// grilla y quedándose con la que entra más; gap chico entre fotos; centrado.

export const PHOTO_GAP_MM = 3;

// Tamaños en mm (cm exactos). 'full' = una foto por hoja (área imprimible).
export const PHOTO_SIZES = [
  { key: 'full', label: 'Página completa' },
  { key: '13x18', label: '13 × 18', wMm: 130, hMm: 180 },
  { key: '10x15', label: '10 × 15', wMm: 100, hMm: 150 },
  { key: '9x13', label: '9 × 13', wMm: 90, hMm: 130 },
  { key: '6x8', label: '6 × 8', wMm: 60, hMm: 80 },
];

// Cuántas celdas de w×h entran en PW×PH con gap entre ellas.
function fitCount(PW, PH, w, h, gap) {
  const cols = Math.floor((PW + gap) / (w + gap));
  const rows = Math.floor((PH + gap) / (h + gap));
  return {
    cols: Math.max(0, cols),
    rows: Math.max(0, rows),
    cellW: w, cellH: h,
    count: Math.max(0, cols) * Math.max(0, rows),
  };
}

// Mejor grilla para un tamaño de foto dentro del área imprimible: prueba la foto
// en sus dos orientaciones (para que la GRILLA entre más) y devuelve la mejor.
export function bestGrid(printWmm, printHmm, photoWmm, photoHmm, gap = PHOTO_GAP_MM) {
  const a = fitCount(printWmm, printHmm, photoWmm, photoHmm, gap);
  const b = fitCount(printWmm, printHmm, photoHmm, photoWmm, gap);
  return b.count > a.count ? b : a;
}

// Layout de un tamaño elegido sobre el área imprimible. Para 'full' devuelve 1
// celda del tamaño del área imprimible. Devuelve { cols, rows, cellW, cellH,
// perSheet, positions[] } en mm (positions relativas al área imprimible).
export function computeLayout(sizeKey, printWmm, printHmm, gap = PHOTO_GAP_MM) {
  let cols, rows, cellW, cellH;
  if (sizeKey === 'full') {
    cols = 1; rows = 1; cellW = printWmm; cellH = printHmm;
  } else {
    const size = PHOTO_SIZES.find((s) => s.key === sizeKey);
    const g = bestGrid(printWmm, printHmm, size.wMm, size.hMm, gap);
    cols = Math.max(1, g.cols); rows = Math.max(1, g.rows);
    cellW = g.cellW; cellH = g.cellH;
    // Si no entra ni una, achicamos a que entre una sola centrada.
    if (g.count === 0) { cols = 1; rows = 1; cellW = Math.min(size.wMm, printWmm); cellH = Math.min(size.hMm, printHmm); }
  }
  const gridW = cols * cellW + (cols - 1) * gap;
  const gridH = rows * cellH + (rows - 1) * gap;
  const originX = Math.max(0, (printWmm - gridW) / 2);
  const originY = Math.max(0, (printHmm - gridH) / 2);
  const positions = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      positions.push({ xMm: originX + c * (cellW + gap), yMm: originY + r * (cellH + gap), wMm: cellW, hMm: cellH });
    }
  }
  return { cols, rows, cellW, cellH, perSheet: cols * rows, positions };
}
