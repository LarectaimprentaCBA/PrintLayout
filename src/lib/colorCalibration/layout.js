// Geometría de la carta de color — port fiel de motor/Carta.cs (kit prueba-color-ricoh).
// Carta A4 a 240 dpi, 343 parches (grilla 7×7×7 RGB) + 4 marcas de registro + marca de orientación.
// NO cambiar estas constantes: la paridad con el kit de referencia depende de ellas.

export const PageWmm = 210.0;
export const PageHmm = 297.0;
export const Dpi = 240; // la misma resolución con la que imprime PrintLayout

export const Levels = [0, 42, 85, 128, 170, 213, 255];
export const N = 7;

export const Cols = 16;
export const Rows = 22;
export const Pitch = 11.0;   // mm entre centros
export const Patch = 9.0;    // mm de lado de cada parche
export const GridLeft = 17.0;
export const GridTop = 30.0;

// Marcas de registro: cuadrado negro con centro blanco (anillo).
export const MarkerOuter = 8.0;
export const MarkerInner = 3.5;
// Centros en mm, en sentido horario: arriba-izq, arriba-der, abajo-der, abajo-izq.
export const Markers = [[12, 12], [198, 12], [198, 285], [12, 285]];

// Cuadradito macizo SOLO junto a la marca de arriba-izquierda: define la orientación.
export const OrientX = 24.0;
export const OrientY = 12.0;
export const OrientSize = 4.0;

export const Count = N * N * N; // 343

export function px(mm) {
  return Math.round((mm / 25.4) * Dpi);
}

export function patchIndices(i) {
  const ri = Math.floor(i / (N * N)) % N;
  const gi = Math.floor(i / N) % N;
  const bi = i % N;
  return [ri, gi, bi];
}

export function patchColor(i) {
  const [ri, gi, bi] = patchIndices(i);
  return [Levels[ri], Levels[gi], Levels[bi]];
}

export function patchCenterMm(i) {
  const col = i % Cols;
  const row = Math.floor(i / Cols);
  const x = GridLeft + col * Pitch + Pitch / 2.0;
  const y = GridTop + row * Pitch + Pitch / 2.0;
  return [x, y];
}
