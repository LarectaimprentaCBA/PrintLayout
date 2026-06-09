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

// Busca la plantilla estándar guardada cuyo id == presetId.
export function resolvePresetTemplate(templates, presetId) {
  if (!Array.isArray(templates) || !presetId) return null;
  return templates.find((t) => t && t.id === presetId) || null;
}
