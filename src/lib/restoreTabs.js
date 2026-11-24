// Reabrir solas las pestañas de la última vez (sin apretar "Restaurar").

export const tieneTrabajo = (t) => !!(t && (t.template || t.jobId));

// PURO. Junta las pestañas guardadas con las que haya ahora en pantalla.
// Lo normal es que en pantalla solo esté la pestaña vacía del arranque (se
// descarta). Pero si en ese instante ya se abrió algo (doble clic en un .pljob
// con la app cerrada), eso NO se pisa: queda al final y sigue siendo la activa.
export function mergeRestoredTabs(actuales, activaActual, guardadas, activaGuardada) {
  const ids = new Set(guardadas.map((t) => t.id));
  const extra = (actuales || []).filter((t) => tieneTrabajo(t) && !ids.has(t.id));
  const tabs = [...guardadas, ...extra];
  const activa = extra.some((t) => t.id === activaActual)
    ? activaActual
    : (ids.has(activaGuardada) ? activaGuardada : tabs[0]?.id ?? null);
  return { tabs, activeTabId: activa };
}
