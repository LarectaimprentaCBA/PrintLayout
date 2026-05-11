// Packing por filas/columnas para "auto-acomodar imagenes".
// Se fija una dimension (alto o ancho) en mm y la otra se calcula proporcional
// al aspect ratio de cada imagen.
//
// - fixedDim === 'alto'  -> empaqueta por filas (todas las imagenes con misma
//                           altura, ancho variable; sin huecos verticales).
// - fixedDim === 'ancho' -> empaqueta por columnas (todas con mismo ancho,
//                           alto variable; sin huecos horizontales).
//
// Modos:
// - repeatToFill=false (default): cada imagen se coloca una sola vez. Si no
//   entra en la hoja actual y multiPage=true, se abre una hoja nueva.
// - repeatToFill=true: una sola hoja; cuando termina de recorrer las imagenes
//   vuelve a empezar hasta que ninguna entre.
//
// Mutuamente exclusivos: con repeatToFill no se agregan hojas; con multiPage
// no se repite el set.

export function packImagesByFixedDimension({
  images,           // [{ naturalWidth, naturalHeight }]
  fixedDim,         // 'alto' | 'ancho'
  fixedValueMm,
  paperW, paperH,   // mm
  marginX = 5,
  marginY = 5,
  spacingX = 2,
  spacingY = 2,
  repeatToFill = false,
  multiPage = true,
  maxPages = 100,
}) {
  const innerW = paperW - 2 * marginX;
  const innerH = paperH - 2 * marginY;

  if (innerW <= 0 || innerH <= 0 || !fixedValueMm || fixedValueMm <= 0) {
    return {
      cells: [], placed: 0, total: images.length, skipped: [],
    };
  }

  const direction = fixedDim === 'ancho' ? 'cols' : 'rows';

  let curX = marginX;
  let curY = marginY;
  let rowH = 0;
  let colW = 0;

  const cells = [];
  const skipped = [];

  const computeWH = (img) => {
    if (!img?.naturalWidth || !img?.naturalHeight) return null;
    if (fixedDim === 'alto') {
      const h = fixedValueMm;
      const w = (img.naturalWidth / img.naturalHeight) * h;
      return { w, h };
    }
    const w = fixedValueMm;
    const h = (img.naturalHeight / img.naturalWidth) * w;
    return { w, h };
  };

  const tryPlace = (w, h) => {
    if (w > innerW + 0.01 || h > innerH + 0.01) {
      return { reason: 'no entra' };
    }
    if (direction === 'rows') {
      if (curX !== marginX && curX + w > marginX + innerW + 0.01) {
        curX = marginX;
        curY += rowH + spacingY;
        rowH = 0;
      }
      if (curY + h > marginY + innerH + 0.01) {
        return { reason: 'sin espacio en la hoja' };
      }
      const cell = { x: curX, y: curY, w, h };
      curX += w + spacingX;
      rowH = Math.max(rowH, h);
      return { cell };
    }
    // direction === 'cols'
    if (curY !== marginY && curY + h > marginY + innerH + 0.01) {
      curY = marginY;
      curX += colW + spacingX;
      colW = 0;
    }
    if (curX + w > marginX + innerW + 0.01) {
      return { reason: 'sin espacio en la hoja' };
    }
    const cell = { x: curX, y: curY, w, h };
    curY += h + spacingY;
    colW = Math.max(colW, w);
    return { cell };
  };

  let currentPage = 0;
  const resetPlacementState = () => {
    curX = marginX;
    curY = marginY;
    rowH = 0;
    colW = 0;
  };

  if (repeatToFill) {
    // Single page, cicla hasta que ninguna entre.
    let cycle = 0;
    while (cycle < 1000) {
      let placedInCycle = 0;
      for (let i = 0; i < images.length; i++) {
        const dims = computeWH(images[i]);
        if (!dims) {
          if (cycle === 0) skipped.push({ index: i, reason: 'sin dimensiones' });
          continue;
        }
        const r = tryPlace(dims.w, dims.h);
        if (r.cell) {
          cells.push({ ...r.cell, imageIndex: i, page: 0 });
          placedInCycle++;
        } else if (cycle === 0) {
          skipped.push({ index: i, reason: r.reason });
        }
      }
      cycle++;
      if (placedInCycle === 0) break;
    }
  } else {
    // Cada imagen una vez. Si no entra y multiPage=true, abre una hoja nueva.
    for (let i = 0; i < images.length; i++) {
      const dims = computeWH(images[i]);
      if (!dims) {
        skipped.push({ index: i, reason: 'sin dimensiones' });
        continue;
      }
      let attempts = 0;
      let placed = false;
      while (attempts < 2 && !placed) {
        const r = tryPlace(dims.w, dims.h);
        if (r.cell) {
          cells.push({ ...r.cell, imageIndex: i, page: currentPage });
          placed = true;
          break;
        }
        if (r.reason === 'no entra') {
          skipped.push({ index: i, reason: 'no entra' });
          break;
        }
        // 'sin espacio en la hoja': nueva hoja si esta permitido.
        if (!multiPage || currentPage + 1 >= maxPages) {
          skipped.push({ index: i, reason: r.reason });
          break;
        }
        currentPage++;
        resetPlacementState();
        attempts++;
      }
    }
  }

  // Agrupar celdas por hoja.
  const numPages = cells.length > 0
    ? Math.max(...cells.map((c) => c.page)) + 1
    : 0;
  const pages = [];
  for (let p = 0; p < numPages; p++) {
    pages.push(cells.filter((c) => c.page === p));
  }

  const uniqueUsed = new Set(cells.map((c) => c.imageIndex)).size;

  return {
    cells,
    pages,
    pageCount: numPages,
    placed: cells.length,
    uniqueUsed,
    total: images.length,
    skipped,
  };
}
