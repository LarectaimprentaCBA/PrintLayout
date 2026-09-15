// Aplicación de la LUT 3D a píxeles, lado main (CommonJS, sin dependencias de Electron
// para poder correr también dentro de un worker_threads). Es la MISMA interpolación
// trilineal + redondeo B8 que el motor ESM (src/lib/colorCalibration); hay un test que
// verifica que dan idéntico (electron/color/__tests__/lut-parity.cjs).
//
// El motor pesado (leer escaneos, calcular la corrección) vive en el renderer, que Vite
// empaqueta. El main solo necesita APLICAR una LUT ya calculada a las hojas al imprimir.

'use strict';

// V: Float32Array/Float64Array/Array aplanado ((r*S+g)*S+b)*3+c en 0..255. size = S.
function makeLut(V, size) {
  return { V, S: size };
}

function triInterp(V, dim, kr, kg, kb, tr, tg, tb, c) {
  const at = (r, g, b) => V[((r * dim + g) * dim + b) * 3 + c];
  const c000 = at(kr, kg, kb), c100 = at(kr + 1, kg, kb);
  const c010 = at(kr, kg + 1, kb), c110 = at(kr + 1, kg + 1, kb);
  const c001 = at(kr, kg, kb + 1), c101 = at(kr + 1, kg, kb + 1);
  const c011 = at(kr, kg + 1, kb + 1), c111 = at(kr + 1, kg + 1, kb + 1);
  const c00 = c000 + (c100 - c000) * tr, c10 = c010 + (c110 - c010) * tr;
  const c01 = c001 + (c101 - c001) * tr, c11 = c011 + (c111 - c011) * tr;
  const c0 = c00 + (c10 - c00) * tg, c1 = c01 + (c11 - c01) * tg;
  return c0 + (c1 - c0) * tb;
}

function b8(v) {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.trunc(v + 0.5);
}

// Aplica la LUT a un color 0..255. Escribe [r,g,b] en `o` (array de 3, floats).
function applyColor(lut, r, g, b, o) {
  const S = lut.S, V = lut.V;
  const fr = (r / 255) * (S - 1), fg = (g / 255) * (S - 1), fb = (b / 255) * (S - 1);
  const kr = Math.max(0, Math.min(S - 2, Math.trunc(fr)));
  const kg = Math.max(0, Math.min(S - 2, Math.trunc(fg)));
  const kb = Math.max(0, Math.min(S - 2, Math.trunc(fb)));
  const tr = fr - kr, tg = fg - kg, tb = fb - kb;
  o[0] = triInterp(V, S, kr, kg, kb, tr, tg, tb, 0);
  o[1] = triInterp(V, S, kr, kg, kb, tr, tg, tb, 1);
  o[2] = triInterp(V, S, kr, kg, kb, tr, tg, tb, 2);
  return o;
}

// Interpola los 3 canales de una vez (misma matemática que applyColor/triInterp, pero
// calculando los offsets de las 8 esquinas una sola vez). Escribe floats en o[0..2].
function interp3(V, S, r, g, b, o) {
  let fr = (r / 255) * (S - 1), fg = (g / 255) * (S - 1), fb = (b / 255) * (S - 1);
  let kr = fr | 0; if (kr > S - 2) kr = S - 2;
  let kg = fg | 0; if (kg > S - 2) kg = S - 2;
  let kb = fb | 0; if (kb > S - 2) kb = S - 2;
  const tr = fr - kr, tg = fg - kg, tb = fb - kb;
  const diR = S * S * 3, diG = S * 3, diB = 3;
  const base = ((kr * S + kg) * S + kb) * 3;
  for (let c = 0; c < 3; c++) {
    const p = base + c;
    const c000 = V[p], c100 = V[p + diR];
    const c010 = V[p + diG], c110 = V[p + diR + diG];
    const c001 = V[p + diB], c101 = V[p + diR + diB];
    const c011 = V[p + diG + diB], c111 = V[p + diR + diG + diB];
    const c00 = c000 + (c100 - c000) * tr, c10 = c010 + (c110 - c010) * tr;
    const c01 = c001 + (c101 - c001) * tr, c11 = c011 + (c111 - c011) * tr;
    const c0 = c00 + (c10 - c00) * tg, c1 = c01 + (c11 - c01) * tg;
    o[c] = c0 + (c1 - c0) * tb;
  }
  return o;
}

// Bucle común con caché de "mismo color que el píxel anterior" (los diseños de imprenta
// tienen grandes zonas planas: fondo blanco, colores sólidos → casi gratis).
// idx = [R,G,B] posiciones dentro de cada pixel de 4 bytes.
function applyLoop(lut, buf, width, height, iR, iG, iB) {
  const V = lut.V, S = lut.S;
  const o = [0, 0, 0];
  const n = width * height;
  let pr = -1, pg = -1, pb = -1, or = 0, og = 0, ob = 0;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const R = buf[j + iR], G = buf[j + iG], B = buf[j + iB];
    if (R !== pr || G !== pg || B !== pb) {
      interp3(V, S, R, G, B, o);
      or = b8(o[0]); og = b8(o[1]); ob = b8(o[2]);
      pr = R; pg = G; pb = B;
    }
    buf[j + iR] = or; buf[j + iG] = og; buf[j + iB] = ob;
    // alfa intacto
  }
  return buf;
}

// BGRA (nativeImage.toBitmap en Windows): R=idx2, G=idx1, B=idx0.
function applyBgraInPlace(lut, bgra, width, height) { return applyLoop(lut, bgra, width, height, 2, 1, 0); }
// RGBA.
function applyRgbaInPlace(lut, rgba, width, height) { return applyLoop(lut, rgba, width, height, 0, 1, 2); }

module.exports = { makeLut, applyColor, applyBgraInPlace, applyRgbaInPlace, triInterp, b8 };
