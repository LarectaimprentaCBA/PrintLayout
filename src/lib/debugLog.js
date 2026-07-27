// Registro de actividad para diagnosticar bugs de uso. Escribe eventos
// significativos a userData/state-debug.log (vía IPC best-effort; nunca tira si
// el canal no está). Queda ACTIVO de forma permanente como red de diagnóstico:
// el archivo se auto-recorta al llegar a ~4MB (main), así que no crece infinito.
// NO se loguea el camino caliente (MIRROR en cada micro-cambio) para no ensuciar.
export function dbg(msg) {
  try {
    window.printlayout?.debug?.log?.(String(msg));
  } catch {
    /* no-op */
  }
}
