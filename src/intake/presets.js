// Presets estándar: tamaños del catálogo de la web cuyos `id` deben matchear
// una plantilla estándar guardada en PrintLayout.
//
// ⚠️ Las plantillas las crea/define Mariano (medidas, márgenes, marco) desde la
// app, con `id` igual al del catálogo web. Acá solo las resolvemos por id; si
// falta, el armador saltea ese tamaño con un mensaje claro (no inventa medidas).
//
// WEB_PRESET_IDS es solo documentación/checklist de qué ids se esperan; no es
// obligatorio que estén todos cargados (se validan al procesar cada pedido).

export const WEB_PRESET_IDS = [
  'polaroid',
  '10x15',
  // TODO(Mariano): completar con el resto del catálogo de la web.
];

// Busca la plancha cuyo ID DE CATÁLOGO (catalogoId) == el id que manda la web.
// El id de catálogo es el que Mariano confirma al "Marcar oficial" (ej.
// "polaroid"); es el enganche estable con la web y el CRM (planchas_catalogo.id).
// Fallback de compatibilidad: si ninguna matchea por catalogoId, probamos el id
// interno por si alguna plantilla vieja lo usaba directamente.
export function resolvePresetTemplate(templates, presetId) {
  if (!Array.isArray(templates) || !presetId) return null;
  return (
    templates.find((t) => t && t.catalogoId === presetId)
    || templates.find((t) => t && t.id === presetId)
    || null
  );
}
