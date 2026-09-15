// Verifica que el aplicador de LUT del main (electron/color/lut.cjs) da EXACTAMENTE lo
// mismo que el motor ESM canónico (src/lib/colorCalibration/applyLut.js).
//   node electron/color/__tests__/lut-parity.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mainLut = require('../lut.cjs');
const { applyLutRgba } = await import('../../../src/lib/colorCalibration/applyLut.js');
const { Lut3 } = await import('../../../src/lib/colorCalibration/colorMath.js');

const S = 17;
// LUT aleatoria plausible (identidad + ruido)
const V = new Float64Array(S * S * S * 3);
for (let r = 0; r < S; r++) for (let g = 0; g < S; g++) for (let b = 0; b < S; b++) {
  const base = ((r * S + g) * S + b) * 3;
  V[base] = Math.max(0, Math.min(255, (255 * r) / (S - 1) + (Math.random() - 0.5) * 20));
  V[base + 1] = Math.max(0, Math.min(255, (255 * g) / (S - 1) + (Math.random() - 0.5) * 20));
  V[base + 2] = Math.max(0, Math.min(255, (255 * b) / (S - 1) + (Math.random() - 0.5) * 20));
}
const esmLut = new Lut3(S); esmLut.V = V;
const mLut = mainLut.makeLut(V, S);

const W = 200, H = 200;
const rgba = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const j = i * 4;
  rgba[j] = (i * 7) & 255; rgba[j + 1] = (i * 13) & 255; rgba[j + 2] = (i * 29) & 255; rgba[j + 3] = 255;
}
const esmOut = applyLutRgba(esmLut, rgba, W, H);
const mOut = new Uint8ClampedArray(rgba);
mainLut.applyRgbaInPlace(mLut, mOut, W, H);

let maxDiff = 0;
for (let k = 0; k < esmOut.length; k++) maxDiff = Math.max(maxDiff, Math.abs(esmOut[k] - mOut[k]));
console.log('max diff RGBA:', maxDiff);

// BGRA idem (convierto)
const bgra = new Uint8ClampedArray(rgba.length);
for (let i = 0; i < W * H; i++) { const j = i * 4; bgra[j] = rgba[j + 2]; bgra[j + 1] = rgba[j + 1]; bgra[j + 2] = rgba[j]; bgra[j + 3] = 255; }
mainLut.applyBgraInPlace(mLut, bgra, W, H);
let maxDiffB = 0;
for (let i = 0; i < W * H; i++) {
  const j = i * 4;
  maxDiffB = Math.max(maxDiffB, Math.abs(bgra[j + 2] - mOut[j]), Math.abs(bgra[j + 1] - mOut[j + 1]), Math.abs(bgra[j] - mOut[j + 2]));
}
console.log('max diff BGRA vs RGBA:', maxDiffB);

const ok = maxDiff === 0 && maxDiffB === 0;
console.log(ok ? '*** LUT PARITY OK ***' : '*** LUT PARITY FALLÓ ***');
process.exit(ok ? 0 : 1);
