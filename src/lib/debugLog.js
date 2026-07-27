// Logger de diagnóstico. DESACTIVADO (no-op) tras encontrar la causa del bug de
// pestañas que se vaciaban (v0.1.101). Se deja el punto de entrada por si hay
// que reactivarlo: descomentar el cuerpo para volver a escribir a
// userData/state-debug.log vía IPC. Las llamadas dbg(...) repartidas por el
// código quedan inertes con esto.
export function dbg(_msg) {
  // window.printlayout?.debug?.log?.(String(_msg));
}
