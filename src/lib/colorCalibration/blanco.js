// El blanco se queda blanco — copia gemela de preservarBlanco() en
// electron/color/lut.cjs (ahí está la explicación completa; el main no puede
// importar de src/). Un test verifica que las dos dan idéntico.
//
// En corto: si el papel de la impresora de referencia escaneó apenas más oscuro
// que el de la otra, la calibración le pone tinta al blanco. Acá el nodo blanco
// vuelve a ser blanco puro y ese corrimiento se retira de a poco SOLO en el
// último escalón medido por la carta (de 212.5 a 255). Lo demás no cambia.

export const BLANCO_DESDE = 212.5;

function recorte(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

// V: tabla aplanada ((r*S+g)*S+b)*3+c en 0..255. Devuelve una Float64Array NUEVA.
export function preservarBlanco(V, S) {
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
