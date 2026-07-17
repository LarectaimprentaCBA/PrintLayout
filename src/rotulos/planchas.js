// Definiciones de plancha de rótulos escolares. Posiciones FIJAS, medidas del
// archivo real. Coordenadas en mm, origen arriba-izquierda (igual que
// exportPdf.js). Preparado para sumar más tipos de plancha en el futuro.

function grid(colsX, rowsY, w, h, size) {
  const out = [];
  for (const y of rowsY) {
    for (const x of colsX) {
      out.push({ x, y, w, h, size });
    }
  }
  return out;
}

function chicoRows() {
  const rows = [];
  for (let y = 272; y <= 442; y += 10) rows.push(y); // 272,282,…,442 → 18 filas
  return rows;
}

export const PLANCHAS = {
  estandar: {
    id: 'estandar',
    label: 'Estándar 325×500',
    pageWidthMm: 325,
    pageHeightMm: 500,
    build() {
      return [
        // GRANDE 60×40: 4 col × 3 fila = 12
        ...grid([38, 101, 164, 227], [51, 94, 137], 60, 40, 'grande'),
        // INTERMEDIO 40×20: 6 col × 4 fila = 24
        ...grid([35, 78, 121, 164, 207, 250], [180, 203, 226, 249], 40, 20, 'intermedio'),
        // CHICO 40×7: 6 col × 18 fila = 108
        ...grid([35, 78, 121, 164, 207, 250], chicoRows(), 40, 7, 'chico'),
      ];
    },
  },
};

export const PLANCHA_LIST = Object.values(PLANCHAS).map((p) => ({ id: p.id, label: p.label }));

// Devuelve { pageWidthMm, pageHeightMm, celdas:[{x,y,w,h,size}] } (144 celdas).
export function planchaCeldas(planchaId = 'estandar') {
  const p = PLANCHAS[planchaId] || PLANCHAS.estandar;
  return {
    pageWidthMm: p.pageWidthMm,
    pageHeightMm: p.pageHeightMm,
    celdas: p.build(),
  };
}
