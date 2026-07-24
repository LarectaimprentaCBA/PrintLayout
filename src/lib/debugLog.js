// Logging de diagnóstico (temporal) para cazar el bug intermitente de
// pestañas que se vacían al abrir un .pljob. Escribe a un archivo en userData
// (state-debug.log) vía IPC best-effort; nunca tira si el canal no está.
// QUITAR cuando se encuentre la causa raíz.
export function dbg(msg) {
  try {
    window.printlayout?.debug?.log?.(String(msg));
  } catch {
    /* no-op */
  }
}
