// Criterio de hoja/márgenes para tamaños CUSTOM que llegan de la web.
//
// ⚠️ PLACEHOLDER — Mariano debe definir esto IGUAL que lo define la web, para
// que la hoja armada coincida con lo que el cliente vio/pagó (hoja base,
// márgenes, espaciado entre fotos, y si lleva marcas de corte). Los presets
// (Polaroid, 10x15, etc.) NO usan esto: usan su plantilla estándar guardada.
//
// Mientras no esté confirmado, dejamos valores razonables marcados con TODO.

export const CUSTOM_SHEET = {
  // TODO(Mariano): poner la hoja base real que usa la web (mm).
  paperWidthMm: 320,
  paperHeightMm: 450,
  // TODO(Mariano): márgenes y espaciado reales.
  marginXMm: 10,
  marginYMm: 10,
  spacingXMm: 3,
  spacingYMm: 3,
  // Marcas de corte generadas: 0 = sin marcas (el operador corta a mano/guía).
  // TODO(Mariano): definir si los tamaños custom llevan corte y su margen.
  markMarginMm: 0,
  cutMarginMm: 0,
  cutShape: 'rect',
};
