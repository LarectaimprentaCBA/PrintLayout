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
//   La ultima hoja puede quedar a medio llenar.
// - repeatToFill=true: ademas de paginar (cada imagen una vez), una pasada
//   final cicla las imagenes en cada hoja rellenando los huecos hasta que
//   ninguna entre. Cap de `maxRefillCycles` por hoja para evitar loops.
//
// Si multiPage=false y repeatToFill=true: una sola hoja ciclada (compat).

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
  maxRefillCycles = 50,
}) {
  const innerW = paperW - 2 * marginX;
  const innerH = paperH - 2 * marginY;

  if (innerW <= 0 || innerH <= 0 || !fixedValueMm || fixedValueMm <= 0) {
    return {
      cells: [], pages: [], pageCount: 0, placed: 0, uniqueUsed: 0,
      total: images.length, skipped: [],
    };
  }

  const direction = fixedDim === 'ancho' ? 'cols' : 'rows';

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

  const newPageState = () => ({
    curX: marginX,
    curY: marginY,
    rowH: 0,
    colW: 0,
  });

  // Intenta colocar (w, h) en la hoja con el state dado. Si entra, muta el
  // state y devuelve { cell }; si no, devuelve { reason }.
  const tryPlaceOnPage = (state, w, h) => {
    if (w > innerW + 0.01 || h > innerH + 0.01) {
      return { reason: 'no entra' };
    }
    if (direction === 'rows') {
      let { curX, curY, rowH } = state;
      if (curX !== marginX && curX + w > marginX + innerW + 0.01) {
        curX = marginX;
        curY += rowH + spacingY;
        rowH = 0;
      }
      if (curY + h > marginY + innerH + 0.01) {
        return { reason: 'sin espacio en la hoja' };
      }
      const cell = { x: curX, y: curY, w, h };
      state.curX = curX + w + spacingX;
      state.curY = curY;
      state.rowH = Math.max(rowH, h);
      return { cell };
    }
    // direction === 'cols'
    let { curX, curY, colW } = state;
    if (curY !== marginY && curY + h > marginY + innerH + 0.01) {
      curY = marginY;
      curX += colW + spacingX;
      colW = 0;
    }
    if (curX + w > marginX + innerW + 0.01) {
      return { reason: 'sin espacio en la hoja' };
    }
    const cell = { x: curX, y: curY, w, h };
    state.curX = curX;
    state.curY = curY + h + spacingY;
    state.colW = Math.max(colW, w);
    return { cell };
  };

  const cells = [];
  const skipped = [];
  const pageStates = [newPageState()];

  if (repeatToFill && !multiPage) {
    // Modo compat: una sola hoja ciclada.
    const state = pageStates[0];
    let cycle = 0;
    while (cycle < 1000) {
      let placedInCycle = 0;
      for (let i = 0; i < images.length; i++) {
        const dims = computeWH(images[i]);
        if (!dims) {
          if (cycle === 0) skipped.push({ index: i, reason: 'sin dimensiones' });
          continue;
        }
        const r = tryPlaceOnPage(state, dims.w, dims.h);
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
    // Pasada 1: cada imagen una vez, paginando si hace falta.
    let currentPageIdx = 0;
    for (let i = 0; i < images.length; i++) {
      const dims = computeWH(images[i]);
      if (!dims) {
        skipped.push({ index: i, reason: 'sin dimensiones' });
        continue;
      }
      let attempts = 0;
      let placed = false;
      while (attempts < 2 && !placed) {
        const r = tryPlaceOnPage(pageStates[currentPageIdx], dims.w, dims.h);
        if (r.cell) {
          cells.push({ ...r.cell, imageIndex: i, page: currentPageIdx });
          placed = true;
          break;
        }
        if (r.reason === 'no entra') {
          skipped.push({ index: i, reason: 'no entra' });
          break;
        }
        if (!multiPage || currentPageIdx + 1 >= maxPages) {
          skipped.push({ index: i, reason: r.reason });
          break;
        }
        currentPageIdx++;
        pageStates.push(newPageState());
        attempts++;
      }
    }

    // Pasada 2: si repeatToFill, ciclar imagenes por cada hoja existente
    // hasta que ninguna entre. Cap de ciclos por hoja.
    if (repeatToFill) {
      const validIndices = [];
      for (let i = 0; i < images.length; i++) {
        if (computeWH(images[i])) validIndices.push(i);
      }
      if (validIndices.length > 0) {
        for (let p = 0; p < pageStates.length; p++) {
          let cycle = 0;
          while (cycle < maxRefillCycles) {
            let placedInCycle = 0;
            for (const i of validIndices) {
              const dims = computeWH(images[i]);
              const r = tryPlaceOnPage(pageStates[p], dims.w, dims.h);
              if (r.cell) {
                cells.push({ ...r.cell, imageIndex: i, page: p });
                placedInCycle++;
              }
            }
            cycle++;
            if (placedInCycle === 0) break;
          }
        }
      }
    }
  }

  // Agrupar celdas por hoja preservando orden de placement.
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
