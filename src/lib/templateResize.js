// Adaptar una plantilla a otra hoja física. Cuando el proveedor cambia el tamaño
// de la hoja unos milímetros, las plantillas con el fondo (bordes + QR + marcas)
// "quemado" quedan más grandes que la hoja nueva: un pedacito se sale del área
// imprimible y el QR deja de leer. Acá encogemos TODO junto —el fondo (vía el
// tamaño de página), las celdas, los cortes y las marcas— a la hoja nueva, así:
//   · el QR y las marcas entran completos y vuelven a leer,
//   · el frente y el dorso escalan igual → siguen registrados (clave en doble faz),
//   · el corte acompaña al diseño (se escala con todo) → print y corte coherentes.
// El escalado es por-eje (la hoja se llena exacta); la diferencia entre ejes es
// de décimas de porciento, imperceptible en tarjetas.

const round4 = (n) => Math.round(n * 10000) / 10000;

function scaleCeldas(celdas, sx, sy) {
  if (!Array.isArray(celdas)) return celdas;
  return celdas.map((c) => ({
    ...c,
    x: round4(c.x * sx),
    y: round4(c.y * sy),
    w: round4(c.w * sx),
    h: round4(c.h * sy),
  }));
}

function scaleCortes(cortes, sx, sy) {
  if (!Array.isArray(cortes)) return cortes;
  return cortes.map((poly) => (Array.isArray(poly)
    ? poly.map(([x, y]) => [round4(x * sx), round4(y * sy)])
    : poly));
}

// Escala una plantilla (o una página de plantilla) a la hoja (newWmm × newHmm).
// Devuelve una copia nueva; no muta el original.
export function scaleTemplateToSheet(template, newWmm, newHmm) {
  if (!template) return template;
  const oldW = Number(template.pageWidthMm);
  const oldH = Number(template.pageHeightMm);
  if (!(oldW > 0) || !(oldH > 0) || !(newWmm > 0) || !(newHmm > 0)) {
    throw new Error('Medidas inválidas para adaptar la plantilla.');
  }
  const sx = newWmm / oldW;
  const sy = newHmm / oldH;
  const savg = (sx + sy) / 2;

  const out = {
    ...template,
    pageWidthMm: newWmm,
    pageHeightMm: newHmm,
    celdas: scaleCeldas(template.celdas, sx, sy),
    celdasDorso: scaleCeldas(template.celdasDorso, sx, sy),
    cortes: scaleCortes(template.cortes, sx, sy),
    cortesDorso: scaleCortes(template.cortesDorso, sx, sy),
  };
  // Las marcas de registro (inset en mm) acompañan el mismo encogido.
  if (Number.isFinite(Number(template.markMarginMm))) {
    out.markMarginMm = round4(template.markMarginMm * savg);
  }
  // Plantillas multi-hoja (combo): cada página tiene sus propias medidas/celdas.
  if (Array.isArray(template.pages)) {
    out.pages = template.pages.map((pg) => {
      const pW = Number(pg.pageWidthMm) > 0 ? Number(pg.pageWidthMm) : oldW;
      const pH = Number(pg.pageHeightMm) > 0 ? Number(pg.pageHeightMm) : oldH;
      const psx = newWmm / pW;
      const psy = newHmm / pH;
      return {
        ...pg,
        pageWidthMm: pg.pageWidthMm != null ? newWmm : pg.pageWidthMm,
        pageHeightMm: pg.pageHeightMm != null ? newHmm : pg.pageHeightMm,
        celdas: scaleCeldas(pg.celdas, psx, psy),
        celdasDorso: scaleCeldas(pg.celdasDorso, psx, psy),
        cortes: scaleCortes(pg.cortes, psx, psy),
        cortesDorso: scaleCortes(pg.cortesDorso, psx, psy),
      };
    });
  }
  return out;
}

// Factores de escala (para mostrar en la UI antes de aplicar).
export function sheetScaleInfo(template, newWmm, newHmm) {
  const oldW = Number(template?.pageWidthMm);
  const oldH = Number(template?.pageHeightMm);
  if (!(oldW > 0) || !(oldH > 0) || !(newWmm > 0) || !(newHmm > 0)) return null;
  return {
    sx: newWmm / oldW,
    sy: newHmm / oldH,
    pctX: (newWmm / oldW - 1) * 100,
    pctY: (newHmm / oldH - 1) * 100,
  };
}
