// Geometría de la impresión de PDF: a qué tamaño se dibuja el diseño y cuánto
// le corta la impresora.
//
// Vive aparte para que lo pueda probar un test y para que haya UNA sola fórmula:
// la vista previa (PdfView.jsx) y la impresión de verdad (printPdf en
// electron/quickprint/service.cjs) tienen que coincidir. Si cambia acá, cambia allá.

/**
 * Tamaño de dibujo del diseño según el modo.
 * @param {{wMm:number,hMm:number,rot:number,printW:number,printH:number,sizeMode:string,scalePct:number}} o
 * @returns {{ew:number,eh:number,twMm:number,thMm:number,factor:number}}
 *   ew/eh = tamaño del diseño ya rotado; twMm/thMm = cómo se dibuja.
 */
export function calcTamano({ wMm, hMm, rot, printW, printH, sizeMode, scalePct }) {
  const ew = rot ? hMm : wMm;
  const eh = rot ? wMm : hMm;
  if (sizeMode === 'actual') return { ew, eh, twMm: ew, thMm: eh, factor: 1 };
  if (sizeMode === 'custom') {
    const s = (Number(scalePct) || 100) / 100;
    return { ew, eh, twMm: ew * s, thMm: eh * s, factor: s };
  }
  const f = sizeMode === 'fitlarge'
    ? Math.min(printW / ew, printH / eh, 1)
    : Math.min(printW / ew, printH / eh); // fit
  return { ew, eh, twMm: ew * f, thMm: eh * f, factor: f };
}

/**
 * Cuánto se corta de cada lado, en mm.
 *
 * El diseño se centra en la hoja FÍSICA (así lo hace el helper en los dos
 * caminos de impresión) y la impresora solo marca dentro del área imprimible:
 * lo que cae fuera de esa zona no sale. Por eso una hoja "del tamaño exacto"
 * del diseño igual pierde el margen duro de la máquina — en la Ricoh MP C8003,
 * 4,23 mm por lado.
 */
export function recortes({ twMm, thMm, paperW, paperH, printW, printH, marginL, marginT }) {
  const izq = Math.max(0, marginL - (paperW - twMm) / 2);
  const der = Math.max(0, (paperW + twMm) / 2 - (marginL + printW));
  const arr = Math.max(0, marginT - (paperH - thMm) / 2);
  const aba = Math.max(0, (paperH + thMm) / 2 - (marginT + printH));
  return { izq, der, arr, aba, hay: izq + der + arr + aba > 0.15 };
}

/** Páginas elegidas: la base (todas / rango) filtrada por impares o pares. */
export function filtrarSubset(paginas, subset) {
  if (subset === 'odd') return paginas.filter((p) => p % 2 === 1);
  if (subset === 'even') return paginas.filter((p) => p % 2 === 0);
  return paginas.slice();
}

/** Parsea "1-3,5" a páginas 1-based, acotadas a [1,count] y sin repetidos. */
export function parseRange(str, count) {
  const out = new Set();
  for (const part of String(str || '').split(',')) {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (i >= 1 && (!count || i <= count)) out.add(i);
    } else {
      const n = parseInt(part.trim(), 10);
      if (Number.isFinite(n) && n >= 1 && (!count || n <= count)) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}
