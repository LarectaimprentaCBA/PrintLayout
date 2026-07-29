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

// Filas Y (mm) de start a end inclusive, paso step. Redondeadas a 0.1 mm.
function rowsRange(start, end, step = 10) {
  const rows = [];
  for (let y = start; y <= end + 1e-9; y += step) rows.push(Math.round(y * 10) / 10);
  return rows;
}

// Columnas X fijas (mismas para grande/interm/chico según tamaño).
const COLS_GRANDE = [38, 101, 164, 227];                 // 4
const COLS_6 = [35, 78, 121, 164, 207, 250];             // 6 (interm y chico)

// Margen de las marcas L (mm). ÚNICA fuente: la comparten el PDF (drawCornerMarks)
// y el payload del .plt (ensureBaseCut). Si difieren, el corte no alinea con la
// impresión.
//
// 25 mm (antes 10): aleja las marcas del borde de la hoja para dejar más "cola"
// de papel. Con marcas a 10 mm el plotter arrastra la hoja justo por el borde
// impreso y el papel se dobla/rompe (sobre todo por los lados largos). El diseño
// está centrado y deja ~35 mm de aire a los lados, así que 25 mm es lo máximo que
// se puede acercar la marca al diseño MANTENIENDO el margen parejo en los 4 lados
// sin que el brazo de la L (10 mm) pise el diseño: el vértice queda a 10 mm del
// diseño por los lados cortos y la cola de papel pasa de 10 a 25 mm. El QR NO se
// toca (sigue a qrBottomMm ≈ 9.5 mm del borde inferior, dentro de la cola).
export const MARK_MARGIN_MM = 25;

// 3 tipos de plancha FIJOS. Todas 325×500 mm, mismos tamaños de rótulo (grande
// 60×40 / interm 40×20 / chico 40×7), gap 3 mm. Cada una: su id = qrId = texto
// del QR = nombre del .plt fijo (el layout NUNCA cambia → corte y QR constantes).
export const PLANCHAS = {
  plancha1: {
    id: 'plancha1',
    label: 'Plancha 1',
    qrId: 'plancha1',
    pageWidthMm: 325,
    pageHeightMm: 500,
    build() {
      return [
        // GRANDE: 4 col × 3 fila = 12
        ...grid(COLS_GRANDE, [51, 94, 137], 60, 40, 'grande'),
        // INTERMEDIO: 6 col × 4 fila = 24
        ...grid(COLS_6, [180, 203, 226, 249], 40, 20, 'intermedio'),
        // CHICO: 6 col × 18 fila = 108
        ...grid(COLS_6, rowsRange(272, 442, 10), 40, 7, 'chico'),
      ]; // 144
    },
  },
  plancha2: {
    id: 'plancha2',
    label: 'Plancha 2',
    qrId: 'plancha2',
    pageWidthMm: 325,
    pageHeightMm: 500,
    build() {
      return [
        // GRANDE: 4 col × 4 fila = 16
        ...grid(COLS_GRANDE, [50.5, 93.5, 136.5, 179.5], 60, 40, 'grande'),
        // CHICO: 6 col × 23 fila = 138
        ...grid(COLS_6, rowsRange(222.5, 442.5, 10), 40, 7, 'chico'),
      ]; // 154
    },
  },
  plancha3: {
    id: 'plancha3',
    label: 'Plancha 3',
    qrId: 'plancha3',
    pageWidthMm: 325,
    pageHeightMm: 500,
    build() {
      return [
        // CHICO: 6 col × 39 fila = 234
        ...grid(COLS_6, rowsRange(56.5, 436.5, 10), 40, 7, 'chico'),
      ]; // 234
    },
  },
};

export const PLANCHA_LIST = Object.values(PLANCHAS).map((p) => ({ id: p.id, label: p.label }));

// Devuelve { pageWidthMm, pageHeightMm, qrId, celdas:[{x,y,w,h,size}] }.
export function planchaCeldas(planchaId = 'plancha1') {
  const p = PLANCHAS[planchaId] || PLANCHAS.plancha1;
  return {
    pageWidthMm: p.pageWidthMm,
    pageHeightMm: p.pageHeightMm,
    qrId: p.qrId,
    celdas: p.build(),
  };
}
