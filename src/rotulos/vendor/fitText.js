// Vendorizado (convención PrintLayout, ver src/dobble/vendor/): motor de
// auto-ajuste de texto para rótulos. Origen conceptual: TarjetasApp
// packages/core/src/pdf/fitText.js (que solo ACHICA). Acá se implementa
// `fitTextIntoBox`, que hace GROW + SHRINK. Si el original cambia, recopiar y
// re-aplicar este archivo.
//
// AGNÓSTICO de plataforma: recibe `measurePt(line, sizePt)` que devuelve el
// ancho del texto EN PUNTOS para ese tamaño. En el preview se pasa un measure
// de canvas (ctx.measureText); en el PDF, font.widthOfTextAtSize de pdf-lib.
// Ambos devuelven el MISMO número (tamaño × avance del glifo), así "lo que ves
// = lo que imprimís".

export const MM_TO_PT = 72 / 25.4;

// Busca el mayor fontSize en [minPt, maxPt] tal que:
//   - cada línea entra a lo ancho:  measurePt(linea, size) <= boxWmm*MM_TO_PT, y
//   - el bloque entra a lo alto:     lines.length*size*lineHeightFactor <= boxHmm*MM_TO_PT.
// Si ni en minPt entra, devuelve minPt (se admite leve desborde).
// Devuelve { fontSizePt, lines }.
export function fitTextIntoBox({
  lines,
  boxWmm,
  boxHmm,
  minPt = 4,
  maxPt = 200,
  lineHeightFactor = 1.15,
  measurePt,
}) {
  const arr = Array.isArray(lines) ? lines : String(lines ?? '').split('\n');
  const useLines = arr.length ? arr : [''];
  const boxWpt = boxWmm * MM_TO_PT;
  const boxHpt = boxHmm * MM_TO_PT;

  const fits = (size) => {
    if (useLines.length * size * lineHeightFactor > boxHpt + 1e-6) return false;
    for (const ln of useLines) {
      if (measurePt(ln, size) > boxWpt + 1e-6) return false;
    }
    return true;
  };

  let best = minPt;
  if (fits(maxPt)) {
    best = maxPt;
  } else if (fits(minPt)) {
    // Búsqueda binaria en el continuo entre min y max.
    let lo = minPt;
    let hi = maxPt;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) { best = mid; lo = mid; } else { hi = mid; }
    }
  } else {
    best = minPt; // ni el mínimo entra: leve desborde a propósito
  }

  return { fontSizePt: Math.round(best * 100) / 100, lines: useLines };
}
