// Qué hojas se mandan a imprimir según lo elegido en la ventana "Imprimir".

// Parsea una lista tipo "1-3,5,7-9" a índices 0-based, validados contra
// totalPages. Devuelve null si hay error de sintaxis o algún rango sale de
// [1..totalPages].
export function parseRange(text, totalPages) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t) return null;
  const result = new Set();
  const parts = t.split(',');
  for (const raw of parts) {
    const seg = raw.trim();
    if (!seg) continue;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(seg);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      if (a > b) [a, b] = [b, a];
      if (a < 1 || b > totalPages) return null;
      for (let i = a; i <= b; i++) result.add(i - 1);
    } else if (/^\d+$/.test(seg)) {
      const n = parseInt(seg, 10);
      if (n < 1 || n > totalPages) return null;
      result.add(n - 1);
    } else {
      return null;
    }
  }
  return [...result].sort((a, b) => a - b);
}

// Índices 0-based de las hojas a imprimir. null = el rango escrito no sirve.
//
// Con UNA sola hoja la ventana no muestra el selector "Todas / Actual / Rango",
// así que la elección no cuenta: se imprime esa hoja. Si contara, un "Rango 2-3"
// que quedó de un trabajo anterior dejaba el botón Imprimir apagado sin nada en
// pantalla que explicara por qué (había que cerrar la app).
export function pagesToPrintFor(pageMode, rangeText, totalPages, currentPage) {
  const total = Math.max(1, Math.floor(Number(totalPages)) || 1);
  if (total <= 1 || pageMode === 'all') {
    return Array.from({ length: total }, (_, i) => i);
  }
  if (pageMode === 'current') {
    return [Math.max(0, Math.min(total - 1, Number(currentPage) || 0))];
  }
  return parseRange(rangeText, total);
}
