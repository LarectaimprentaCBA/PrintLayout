// Construye las filas del catálogo de planchas para publicar a Supabase
// (tabla `planchas_catalogo`). PrintLayout es la FUENTE DE VERDAD del catálogo.
//
// Por cada plancha OFICIAL: { id, label, wmm, hmm, fotos_por_plancha }.
//   - id = id interno de la plantilla (estable; viaja por la sincronización
//     entre PCs). Es el enganche que usan la web, el CRM y la entrada de pedidos.
//   - wmm/hmm = tamaño de la foto (celda); fotos_por_plancha = cantidad de celdas.
// Más UNA fila `personalizado` con el criterioHoja global (hoja base + márgenes
// + espaciado) para los tamaños custom. Los PRECIOS NO van acá (los maneja el CRM).

import { CUSTOM_SHEET } from './sheetCriteria.js';

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

export function buildCatalogRows(templates) {
  const oficiales = (templates || []).filter((t) => t && t.oficial);
  const rows = oficiales.map((t) => {
    const celdas = Array.isArray(t.celdas) ? t.celdas : [];
    const c0 = celdas[0] || {};
    return {
      id: t.id,
      label: t.name || t.id,
      wmm: round1(c0.w),
      hmm: round1(c0.h),
      fotos_por_plancha: celdas.length,
      criterio_hoja: null,
    };
  });

  // Fila del personalizado: el criterioHoja global que usa el armado de tamaños
  // custom (mismo que la web debe replicar).
  rows.push({
    id: 'personalizado',
    label: 'Personalizado',
    wmm: null,
    hmm: null,
    fotos_por_plancha: null,
    criterio_hoja: {
      paperWmm: CUSTOM_SHEET.paperWidthMm,
      paperHmm: CUSTOM_SHEET.paperHeightMm,
      marginXMm: CUSTOM_SHEET.marginXMm,
      marginYMm: CUSTOM_SHEET.marginYMm,
      spacingXMm: CUSTOM_SHEET.spacingXMm,
      spacingYMm: CUSTOM_SHEET.spacingYMm,
    },
  });

  return rows;
}
