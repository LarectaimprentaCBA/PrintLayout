// Catálogo de planchas: PrintLayout es la FUENTE DE VERDAD.
//
// Tabla `planchas_catalogo` (PK = id de catálogo/negocio):
//   id                   -> id ESTABLE de negocio (ej. "polaroid"). Lo tipea/confirma
//                           Mariano al marcar oficial. Es el enganche con la web
//                           (items.tamano.id) y el CRM (precios_planchas.plancha_id).
//   label                -> nombre visible.
//   wmm, hmm             -> tamaño de la foto (celda).
//   fotos_por_plancha    -> cantidad de celdas.
//   plantilla_printlayout-> id interno de la plantilla (cómo la cargo para armar).
//   activo               -> baja lógica (la web filtra activo=true).
//
// El criterioHoja del "A medida" NO va acá: va a `config_fotos`
// (clave 'criterio_hoja_custom'). Los PRECIOS los maneja el CRM (no van acá).

import { CUSTOM_SHEET } from './sheetCriteria.js';

export const CRITERIO_CUSTOM_KEY = 'criterio_hoja_custom';

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

// Sugerencia de id de catálogo a partir del nombre (Mariano la puede cambiar).
export function slugifyCatalogId(name) {
  return (
    String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // saca tildes/diacríticos
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'plancha'
  );
}

// Fila de catálogo para una plantilla (con su catalogoId ya asignado).
export function catalogRowForTemplate(t, activo) {
  const celdas = Array.isArray(t.celdas) ? t.celdas : [];
  const c0 = celdas[0] || {};
  return {
    id: t.catalogoId,
    label: t.name || t.catalogoId,
    wmm: round1(c0.w),
    hmm: round1(c0.h),
    fotos_por_plancha: celdas.length,
    plantilla_printlayout: t.id,
    activo: !!activo,
  };
}

// Todas las oficiales activas (para "Publicar catálogo" de una).
export function buildCatalogRows(templates) {
  return (templates || [])
    .filter((t) => t && t.oficial && t.catalogoId)
    .map((t) => catalogRowForTemplate(t, true));
}

// Valor jsonb del criterio del "A medida" para config_fotos.
// Las 6 claves base (paperW/H, marginX/Y, spacingX/Y) son el contrato fijo; el
// resto (corte y rango min/max) son aditivas para que la web valide qué tamaños
// acepta y sepa cómo se arma la hoja. El máximo = área útil (hoja − márgenes).
export function buildCriterioCustomValue() {
  const usableW = round1(CUSTOM_SHEET.paperWidthMm - 2 * CUSTOM_SHEET.marginXMm);
  const usableH = round1(CUSTOM_SHEET.paperHeightMm - 2 * CUSTOM_SHEET.marginYMm);
  return {
    paperW: CUSTOM_SHEET.paperWidthMm,
    paperH: CUSTOM_SHEET.paperHeightMm,
    marginX: CUSTOM_SHEET.marginXMm,
    marginY: CUSTOM_SHEET.marginYMm,
    spacingX: CUSTOM_SHEET.spacingXMm,
    spacingY: CUSTOM_SHEET.spacingYMm,
    // Cómo se arma/corta la hoja.
    markMargin: CUSTOM_SHEET.markMarginMm,
    cutMargin: CUSTOM_SHEET.cutMarginMm,
    cutShape: CUSTOM_SHEET.cutShape,
    // Rango de tamaños aceptados (mm).
    minW: CUSTOM_SHEET.minWmm,
    minH: CUSTOM_SHEET.minHmm,
    maxW: usableW,
    maxH: usableH,
  };
}
