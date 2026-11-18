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

// ── El blanco se queda blanco ────────────────────────────────────────────────
// La calibración compara dos hojas ESCANEADAS. Si el papel de la impresora de
// referencia es apenas más oscuro o más amarillo que el de la otra, el motor
// "aprende" que para igualarlo hay que ponerle tinta al blanco: el fondo de un
// plano o de un texto sale con un velo gris (y en una láser, gastando tóner en
// toda la hoja). Imitar el color del papel ajeno nunca es lo que se quiere.
//
// Arreglo: el nodo blanco vuelve a ser blanco puro y ese mismo corrimiento se
// va retirando de a poco en los colores casi blancos. Se retira SOLO dentro del
// último escalón medido por la carta (7 niveles por canal: …, 212.5, 255), que
// es justo la zona donde la tabla está interpolando contra el papel; de 212.5
// para abajo queda EXACTAMENTE como se calibró.
//
// Se aplica al USAR la tabla (no se toca lo guardado ni lo compartido), así
// vale también para las calibraciones viejas sin volver a escanear. Aplicarla
// dos veces da lo mismo que una.
// OJO: copia gemela en src/lib/colorCalibration/blanco.js (el main no puede
// importar de src/). Hay un test que verifica que dan idéntico.
const BLANCO_DESDE = 212.5;
function preservarBlanco(V, S) {
  const n = S * S * S * 3;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = V[i];
  const w = n - 3; // nodo (S-1, S-1, S-1)
  const d0 = V[w] - 255, d1 = V[w + 1] - 255, d2 = V[w + 2] - 255;
  if (d0 === 0 && d1 === 0 && d2 === 0) return out;
  const paso = 255 / (S - 1);
  for (let r = 0; r < S; r++) {
    for (let g = 0; g < S; g++) {
      for (let b = 0; b < S; b++) {
        const m = Math.min(r, g, b) * paso;
        if (m <= BLANCO_DESDE) continue;
        const k = (m - BLANCO_DESDE) / (255 - BLANCO_DESDE);
        const base = ((r * S + g) * S + b) * 3;
        out[base] = recorte(V[base] - k * d0);
        out[base + 1] = recorte(V[base + 1] - k * d1);
        out[base + 2] = recorte(V[base + 2] - k * d2);
      }
    }
  }
  out[w] = 255; out[w + 1] = 255; out[w + 2] = 255; // exacto, sin error de redondeo
  return out;
}
function recorte(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

module.exports = { makeLut, applyColor, applyBgraInPlace, applyRgbaInPlace, triInterp, b8, preservarBlanco, BLANCO_DESDE };
