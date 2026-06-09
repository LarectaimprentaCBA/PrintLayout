// Criterio de hoja/márgenes para tamaños CUSTOM que llegan de la web.
//
// Definido por Mariano (La Recta) IGUAL que la web, para que la hoja armada
// coincida con lo que el cliente vio/pagó. Los presets (Polaroid, 10x15, etc.)
// NO usan esto: usan su plantilla estándar guardada.
//
// Estos valores se publican a Supabase (config_fotos / criterio_hoja_custom)
// con "Publicar catálogo". Si los cambiás, volvé a publicar.

export const CUSTOM_SHEET = {
  // Hoja base: A4.
  paperWidthMm: 210,
  paperHeightMm: 297,
  // Márgenes desde el borde de la hoja y separación entre fotos.
  marginXMm: 10,
  marginYMm: 10,
  spacingXMm: 3,
  spacingYMm: 3,
  // Corte con plotter: marcas L a 10 mm del borde de la hoja; el corte entra
  // 1 mm hacia adentro de la foto. Rectangular.
  markMarginMm: 10,
  cutMarginMm: 1,
  cutShape: 'rect',
  // Rango de tamaños aceptados (mm). El mínimo es fijo; el máximo lo calcula
  // buildCriterioCustomValue como área útil (hoja − márgenes) para que no
  // quede desactualizado si cambia la hoja.
  minWmm: 40,
  minHmm: 40,
};
