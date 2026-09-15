// Código legible por máquina impreso en la banda inferior de la carta.
// Codifica: id de sesión (16 bits) + rol (referencia/a-corregir) + dígito de control.
// El lector asigna cada escaneo por este código, NO por el nombre del archivo, así no
// se pueden cargar cruzados. Se lee con la MISMA homografía mm→px de las marcas.

// Geometría de la banda (mm), entre los anillos de abajo (y≈285, x 30..180).
export const BAND_Y = 285.0;     // centro vertical de las celdas (mm)
export const CELL_W = 5.0;       // ancho de cada celda (mm)
export const CELL_H = 7.0;       // alto de cada celda (mm)
export const BAND_X0 = 30.0;     // borde izquierdo de la primera celda (mm)

export const ROLE_REFERENCE = 0; // impresora de referencia (buena)
export const ROLE_CORRECT = 1;   // impresora a corregir (pálida)

// Estructura de celdas (26): [guardaNegra][guardaBlanca][id 16b MSB..LSB][rol 2b][control 6b]
const N_GUARD = 2;
const N_ID = 16;
const N_ROLE = 2;
const N_CHECK = 6;
export const N_CELLS = N_GUARD + N_ID + N_ROLE + N_CHECK; // 26

// Valor de control: 6 bits, valor entero (id<<2 | rolCod) módulo 61 (primo).
function checkValue(sessionId, roleCode2) {
  const v = ((sessionId & 0xffff) * 4) + (roleCode2 & 0x3);
  return v % 61;
}

// Devuelve los bits (0/1) de las N_CELLS celdas para un id + rol.
export function encodeBits(sessionId, role) {
  const bits = new Array(N_CELLS).fill(0);
  bits[0] = 1; // guarda negra
  bits[1] = 0; // guarda blanca
  let p = N_GUARD;
  for (let i = N_ID - 1; i >= 0; i--) bits[p++] = (sessionId >> i) & 1;
  const roleCode = role === ROLE_CORRECT ? 0b11 : 0b00; // redundante para detectar error
  bits[p++] = (roleCode >> 1) & 1;
  bits[p++] = roleCode & 1;
  const chk = checkValue(sessionId, roleCode);
  for (let i = N_CHECK - 1; i >= 0; i--) bits[p++] = (chk >> i) & 1;
  return bits;
}

// Decodifica bits → { sessionId, role } o null si el control no cierra.
export function decodeBits(bits) {
  if (!bits || bits.length !== N_CELLS) return null;
  if (bits[0] !== 1 || bits[1] !== 0) return null; // guardas
  let p = N_GUARD;
  let id = 0;
  for (let i = 0; i < N_ID; i++) id = (id << 1) | (bits[p++] & 1);
  const roleCode = ((bits[p++] & 1) << 1) | (bits[p++] & 1);
  if (roleCode !== 0b00 && roleCode !== 0b11) return null; // rol corrupto
  let chk = 0;
  for (let i = 0; i < N_CHECK; i++) chk = (chk << 1) | (bits[p++] & 1);
  if (chk !== checkValue(id, roleCode)) return null;
  return { sessionId: id, role: roleCode === 0b11 ? ROLE_CORRECT : ROLE_REFERENCE };
}

// Centros (mm) de cada celda, para dibujar o leer.
export function cellCentersMm() {
  const out = [];
  for (let i = 0; i < N_CELLS; i++) out.push([BAND_X0 + i * CELL_W + CELL_W / 2, BAND_Y]);
  return out;
}

// Dibuja el código en un contexto 2D (mm→px con `px(mm)`). fill = color negro.
export function drawCode(ctx, bits, px, black = '#000', white = '#fff') {
  for (let i = 0; i < N_CELLS; i++) {
    const cx = BAND_X0 + i * CELL_W + CELL_W / 2;
    const x0 = px(cx - CELL_W / 2), y0 = px(BAND_Y - CELL_H / 2);
    const x1 = px(cx + CELL_W / 2), y1 = px(BAND_Y + CELL_H / 2);
    ctx.fillStyle = bits[i] ? black : white;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}

// Lee el código del escaneo usando la homografía mm→px `h` y una función de
// muestreo `sampleLum(cxMm, cyMm, halfMm)` → luminancia media. Devuelve el resultado
// de decodeBits o null. Umbral relativo a las dos celdas guarda (negra/blanca).
export function readCode(sampleLum) {
  const lums = [];
  for (let i = 0; i < N_CELLS; i++) {
    const cx = BAND_X0 + i * CELL_W + CELL_W / 2;
    lums.push(sampleLum(cx, BAND_Y, Math.min(CELL_W, CELL_H) * 0.3));
  }
  const black = lums[0], whiteL = lums[1];
  if (whiteL - black < 30) return null; // sin contraste: no hay código legible
  const thr = (black + whiteL) / 2;
  const bits = lums.map((l) => (l < thr ? 1 : 0));
  return decodeBits(bits);
}

// Genera un id de sesión aleatorio de 16 bits (>0).
export function newSessionId() {
  return 1 + Math.floor(Math.random() * 0xfffe);
}

// Valida un par de mediciones por su código: mismo id, roles {referencia, a-corregir}.
// Devuelve { buena, palida } (las mediciones ordenadas por rol) o lanza con motivo claro.
export function pairByCode(scanA, scanB) {
  const a = scanA.code, b = scanB.code;
  if (!a || !b) throw new Error('CODE_MISSING');
  if (a.sessionId !== b.sessionId) throw new Error('CODE_SESSION_MISMATCH');
  if (a.role === b.role) throw new Error('CODE_ROLE_DUP');
  const buena = a.role === ROLE_REFERENCE ? scanA : scanB;
  const palida = a.role === ROLE_CORRECT ? scanA : scanB;
  return { buena, palida };
}
