// Aplica una Lut3 a un buffer de píxeles RGBA (in-place sobre una copia).
// Usado por el motor de prueba y por la corrección al imprimir (main → worker).
import { Lut3 } from './colorMath.js';

// data: Uint8Array/Uint8ClampedArray RGBA. Devuelve un buffer nuevo del mismo largo.
export function applyLutRgba(lut, data, width, height) {
  const out = new Uint8ClampedArray(data.length);
  const o = new Float64Array(3);
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    lut.apply(data[j], data[j + 1], data[j + 2], o);
    out[j] = b8(o[0]);
    out[j + 1] = b8(o[1]);
    out[j + 2] = b8(o[2]);
    out[j + 3] = data[j + 3];
  }
  return out;
}

// Redondeo a byte como Imagen.B8 del kit: v+0.5 truncado, con recorte 0..255.
function b8(v) {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.trunc(v + 0.5);
}

export { Lut3 };
