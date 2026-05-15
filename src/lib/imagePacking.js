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

// Packing por cantidad-objetivo de celdas por hoja: el usuario fija N (ej. 6) y
// el algoritmo busca la (filas, columnas) que maximiza el tamano de celda dentro
// de la hoja, respetando un aspect ratio target.
//
// - El AR de la celda puede forzarse via cellAspect (W/H). Si no se pasa, se
//   calcula del promedio de las imagenes cargadas.
// - Si hay mas imagenes que count, se paginan (count por hoja). En la ultima
//   hoja, si M no es multiplo de count, las celdas sobrantes se rellenan
//   ciclando las imagenes de esa hoja con distribucion equitativa.
// - Si hay menos imagenes que count, una sola hoja con count celdas y las
//   imagenes se ciclan equitativamente.
//
// Devuelve la misma forma que packImagesByFixedDimension para reusar el wiring.

function distributeIndicesEvenly(N, K) {
  // Devuelve array de longitud N con valores 0..K-1 distribuidos parejo,
  // agrupados (A A A B B B ...). Las primeras (N%K) imagenes salen una vez mas.
  const result = [];
  if (N <= 0 || K <= 0) return result;
  const base = Math.floor(N / K);
  const extras = N % K;
  for (let k = 0; k < K; k++) {
    const copies = k < extras ? base + 1 : base;
    for (let c = 0; c < copies; c++) result.push(k);
  }
  return result;
}

export function packImagesByCount({
  images,           // [{ naturalWidth, naturalHeight }]
  count,            // celdas por hoja (objetivo)
  paperW, paperH,
  marginX = 5,
  marginY = 5,
  spacingX = 2,
  spacingY = 2,
  cellAspect = null, // W/H del cell; si null, se calcula del promedio de imagenes
}) {
  const empty = () => ({
    cells: [], pages: [], pageCount: 0, placed: 0, uniqueUsed: 0,
    total: images?.length || 0, skipped: [], grid: null,
  });

  const innerW = paperW - 2 * marginX;
  const innerH = paperH - 2 * marginY;
  const N = Math.floor(Number(count) || 0);

  if (innerW <= 0 || innerH <= 0 || N <= 0) return empty();

  // Aspect ratio target del cell
  let targetAR = Number(cellAspect);
  if (!Number.isFinite(targetAR) || targetAR <= 0) {
    const ars = (images || [])
      .filter((img) => img?.naturalWidth > 0 && img?.naturalHeight > 0)
      .map((img) => img.naturalWidth / img.naturalHeight);
    if (ars.length > 0) {
      targetAR = ars.reduce((s, a) => s + a, 0) / ars.length;
    } else {
      targetAR = innerW / innerH;
    }
  }

  // Probar todas las (rows, cols) con rows*cols >= N. Para no explotar el espacio
  // de busqueda, iteramos rows en 1..N y cols = ceil(N/rows). Eso da las
  // factorizaciones exactas y algunas con extras (cuando N no es divisible).
  // Tambien intentamos cols = ceil(N/rows) + 1 para cubrir casos donde sumar
  // una columna extra (con celdas vacias) rinde celdas mas grandes.
  let best = null;
  const candidates = new Set();
  for (let rows = 1; rows <= N; rows++) {
    const base = Math.ceil(N / rows);
    candidates.add(`${rows},${base}`);
    if (base > 1) candidates.add(`${rows},${base + 1}`);
  }
  for (const key of candidates) {
    const [rows, cols] = key.split(',').map(Number);
    if (rows * cols < N) continue;
    const availW = innerW - (cols - 1) * spacingX;
    const availH = innerH - (rows - 1) * spacingY;
    if (availW <= 0 || availH <= 0) continue;
    const maxW = availW / cols;
    const maxH = availH / rows;
    let cw = maxW;
    let ch = maxH;
    if (cw / ch > targetAR) cw = ch * targetAR;
    else ch = cw / targetAR;
    if (cw <= 0 || ch <= 0) continue;
    const area = cw * ch;
    const emptyCells = rows * cols - N;
    // Premia area; penaliza levemente celdas vacias (tie-break).
    const score = area - area * emptyCells * 0.001;
    if (!best || score > best.score) {
      best = { rows, cols, cw, ch, area, emptyCells, score };
    }
  }

  if (!best) return empty();

  const { rows, cols, cw, ch } = best;

  // Construir grilla centrada en la hoja
  const totalGridW = cols * cw + (cols - 1) * spacingX;
  const totalGridH = rows * ch + (rows - 1) * spacingY;
  const startX = marginX + (innerW - totalGridW) / 2;
  const startY = marginY + (innerH - totalGridH) / 2;

  const allGridCells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      allGridCells.push({
        x: startX + c * (cw + spacingX),
        y: startY + r * (ch + spacingY),
        w: cw,
        h: ch,
      });
    }
  }

  // Solo usamos las primeras N celdas (orden left-to-right, top-to-bottom).
  const usableCells = allGridCells.slice(0, N);

  const M = (images || []).filter(
    (img) => img?.naturalWidth > 0 && img?.naturalHeight > 0,
  ).length;
  if (M === 0) return empty();

  const validIndices = [];
  for (let i = 0; i < images.length; i++) {
    if (images[i]?.naturalWidth > 0 && images[i]?.naturalHeight > 0) {
      validIndices.push(i);
    }
  }

  const skipped = [];
  for (let i = 0; i < images.length; i++) {
    if (!images[i]?.naturalWidth || !images[i]?.naturalHeight) {
      skipped.push({ index: i, reason: 'sin dimensiones' });
    }
  }

  // Si M <= N: una hoja, ciclar imagenes en N celdas (distribuye parejo).
  // Si M > N: paginar (N celdas por hoja). En la ultima, si quedan huecos,
  // ciclar las imagenes de esa hoja.
  const pageCount = M <= N ? 1 : Math.ceil(M / N);

  const cells = [];
  const pages = [];

  for (let p = 0; p < pageCount; p++) {
    const pageStart = p * N;
    const pageEnd = Math.min(M, pageStart + N);
    const imagesOnPage = pageEnd - pageStart; // imagenes unicas en esta hoja

    let mapping;
    if (imagesOnPage >= N) {
      mapping = [];
      for (let i = 0; i < N; i++) mapping.push(i);
    } else {
      // Distribuir las `imagesOnPage` imagenes en N celdas.
      mapping = distributeIndicesEvenly(N, imagesOnPage);
    }

    const pageCells = usableCells.map((c, i) => ({
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
      imageIndex: validIndices[pageStart + mapping[i]],
      page: p,
    }));
    pages.push(pageCells);
    cells.push(...pageCells);
  }

  const uniqueUsed = new Set(cells.map((c) => c.imageIndex)).size;

  return {
    cells,
    pages,
    pageCount,
    placed: cells.length,
    uniqueUsed,
    total: images.length,
    skipped,
    grid: { rows, cols, cellW: cw, cellH: ch },
  };
}
