// Motor de calibración de color — API pública.
// Port fiel del kit prueba-color-ricoh (motor/*.cs). Ver docs en cada módulo.
export * as Layout from './layout.js';
export { rgbToLab, deltaE, GrillaMedida, Lut3, triInterp } from './colorMath.js';
export { medir, homografia, mapear, lum } from './reader.js';
export { calcular, informeCorregida } from './correccion.js';
export { applyLutRgba } from './applyLut.js';
export * as Code from './code.js';
export {
  encodeBits, decodeBits, drawCode, readCode, pairByCode, newSessionId,
  ROLE_REFERENCE, ROLE_CORRECT, N_CELLS,
} from './code.js';

export const ENGINE_VERSION = 1;
export const LUT_SIZE = 17;
