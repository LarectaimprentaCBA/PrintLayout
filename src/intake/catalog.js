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
//   marco_wmm, marco_hmm -> tamaño del MARCO (corte exterior) que envuelve la foto
//                           (ej. el borde blanco de una Polaroid). null si no hay marco.
//   foto_left_mm, foto_top_mm -> posición de la foto dentro del marco (offset desde
//                           el borde sup-izq del marco). null si no hay marco.
//   Con esos 4 campos la web puede dibujar la plancha real; si son null dibuja la
//   foto sola (sticker / foto a sangre).
//
// El criterioHoja del "A medida" NO va acá: va a `config_fotos`
// (clave 'criterio_hoja_custom'). Los PRECIOS los maneja el CRM (no van acá).

import { CUSTOM_SHEET } from './sheetCriteria.js';

export const CRITERIO_CUSTOM_KEY = 'criterio_hoja_custom';

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

// bbox de una polilínea [[x,y],…].
function bbox(poly) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

// Geometría del MARCO (el corte exterior) que envuelve la primera foto, para que la
// web dibuje la plancha real (ej. el borde blanco de una Polaroid). Busca, entre los
// cortes, el rectángulo que CONTIENE el centro de la celda y la ENVUELVE con borde;
// si hay varios, elige el más ajustado (evita agarrar un trim de hoja completa).
//
// Si el corte va HACIA ADENTRO de la foto (sticker / foto a sangre, sin borde) o no
// hay corte, devuelve los 4 campos en null → la web dibuja la foto sola. NO inventa
// marco.
export function frameForTemplate(t) {
  const empty = { wmm: null, hmm: null, left: null, top: null };
  const cell = (Array.isArray(t.celdas) ? t.celdas : [])[0] || {};
  const cortes = Array.isArray(t.cortes) ? t.cortes : [];
  if (!(cell.w > 0 && cell.h > 0)) return empty;

  const cx = cell.x + cell.w / 2;
  const cy = cell.y + cell.h / 2;
  const TOL = 0.5; // mm

  let best = null;
  for (const poly of cortes) {
    if (!Array.isArray(poly) || poly.length < 2) continue;
    const b = bbox(poly);
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;
    const contiene = b.minX <= cx && cx <= b.maxX && b.minY <= cy && cy <= b.maxY;
    const envuelve = bw >= cell.w - TOL && bh >= cell.h - TOL;
    // Tiene que sobrar al menos un borde real; si el corte == la foto (a sangre,
    // margen 0) o va para adentro, no es un marco.
    const hayBorde = bw > cell.w + TOL || bh > cell.h + TOL;
    if (contiene && envuelve && hayBorde) {
      const area = bw * bh;
      if (!best || area < best.area) {
        best = {
          area,
          wmm: round1(bw),
          hmm: round1(bh),
          left: round1(cell.x - b.minX),
          top: round1(cell.y - b.minY),
        };
      }
    }
  }
  if (!best) return empty;
  return { wmm: best.wmm, hmm: best.hmm, left: best.left, top: best.top };
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
  const marco = frameForTemplate(t);
  return {
    id: t.catalogoId,
    label: t.name || t.catalogoId,
    wmm: round1(c0.w),
    hmm: round1(c0.h),
    fotos_por_plancha: celdas.length,
    plantilla_printlayout: t.id,
    activo: !!activo,
    // Geometría del marco (null si la foto va a sangre / sin borde).
    marco_wmm: marco.wmm,
    marco_hmm: marco.hmm,
    foto_left_mm: marco.left,
    foto_top_mm: marco.top,
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
