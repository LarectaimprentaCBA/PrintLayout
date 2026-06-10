// Reporte global de imágenes salteadas al importar (HEIC que no convirtió,
// formato no soportado, archivo ilegible, etc.). App registra un único
// "reporter"; así TODOS los flujos de importación avisan al usuario qué
// archivos quedaron afuera, sin tener que tocar cada handler.

let _reporter = null;

export function setImportSkipReporter(fn) {
  _reporter = typeof fn === 'function' ? fn : null;
}

// skipped: Array<{ name, reason }>
export function reportImportSkips(skipped) {
  if (Array.isArray(skipped) && skipped.length && _reporter) {
    try {
      _reporter(skipped.slice());
    } catch {
      // Nunca romper la importación por un fallo al avisar.
    }
  }
}
