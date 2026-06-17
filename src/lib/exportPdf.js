import { PDFDocument, rgb, degrees } from 'pdf-lib';
import {
  cellPositions,
  cellsForPage,
  pageStartOffset,
  fixedPageCount,
  backRotate180,
} from './templates.js';
import { coverCropRect, coverObjectPosition } from './faceDetection.js';
import { cropImageDataUrl } from './imageCrop.js';
import { renderPdfBytesToImages } from './pdfPreview.js';

const MM_TO_PT = 72 / 25.4;

function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const base64 = dataUrl.slice(comma + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function detectMime(dataUrl, fallback = 'image/jpeg') {
  const m = /^data:([^;]+);/.exec(dataUrl);
  return m ? m[1].toLowerCase() : fallback;
}

// '#rrggbb' (el formato del <input type="color">) → rgb() de pdf-lib. Negro si
// no parsea.
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return rgb(0, 0, 0);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function fitContain(cellW, cellH, imgW, imgH) {
  const cellAr = cellW / cellH;
  const imgAr = imgW / imgH;
  let drawW;
  let drawH;
  if (imgAr > cellAr) {
    drawW = cellW;
    drawH = cellW / imgAr;
  } else {
    drawH = cellH;
    drawW = cellH * imgAr;
  }
  const dx = (cellW - drawW) / 2;
  const dy = (cellH - drawH) / 2;
  return { drawW, drawH, dx, dy };
}

// 4 marcas L vectoriales en las esquinas del area de la plantilla. Las usa el
// plotter A3 Max 4 Pro para alinear el corte opticamente. Se dibujan solo
// cuando la plantilla no tiene fondo propio (grilla rapida, auto-pack) y
// `markMarginMm > 0`.
//
// El brazo de cada L apunta hacia adentro del area de corte: la esquina
// interior de la L coincide con la esquina de la ventana de corte (es decir,
// la posicion que el plotter espera). Brazo 10 mm, trazo 0.3 mm, color negro.
function drawCornerMarks(page, {
  offsetXpt, offsetYpt, templateWpt, templateHpt, markMarginMm,
}) {
  if (!markMarginMm || markMarginMm <= 0) return;
  const m = markMarginMm * MM_TO_PT;
  const arm = 10 * MM_TO_PT;
  const thickness = 0.3 * MM_TO_PT;
  const color = rgb(0, 0, 0);

  // En coords PDF (Y arriba). top = Y alta, bottom = Y baja.
  const left = offsetXpt + m;
  const right = offsetXpt + templateWpt - m;
  const top = offsetYpt + templateHpt - m;
  const bottom = offsetYpt + m;

  if (right <= left || top <= bottom) return;

  const line = (x1, y1, x2, y2) => page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness,
    color,
  });

  // Top-left: brazos a la derecha y hacia abajo.
  line(left, top, left + arm, top);
  line(left, top, left, top - arm);
  // Top-right: brazos a la izquierda y hacia abajo.
  line(right, top, right - arm, top);
  line(right, top, right, top - arm);
  // Bottom-left: brazos a la derecha y hacia arriba.
  line(left, bottom, left + arm, bottom);
  line(left, bottom, left, bottom + arm);
  // Bottom-right: brazos a la izquierda y hacia arriba.
  line(right, bottom, right - arm, bottom);
  line(right, bottom, right, bottom + arm);

  // Punto guia centrado entre las 2 L de arriba. Indica al operador cual es
  // el "frente" de la hoja al ponerla en el plotter. Esta sobre la misma
  // linea horizontal que las L y bien adentro de la ventana, asi el plotter
  // no lo confunde con una marca de registro (esas las espera en esquinas).
  page.drawCircle({
    x: (left + right) / 2,
    y: top,
    size: 1 * MM_TO_PT,
    color,
  });
}

function base64ToBytes(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Renderiza una "cara" (frente o dorso) como pagina(s) sobre un doc existente.
// El embedCache se comparte entre llamadas para que las mismas imagenes usadas
// en frente y dorso se embeban una sola vez.
async function appendFaceToDoc(doc, ctx, template, assignments, options) {
  const { layoutFitMode, embedBackground, face, paperWmm, paperHmm } = options;
  // drawMarks: si es false, NO se dibujan las marcas L de corte aunque la
  // plantilla las tenga generadas. Default true (comportamiento histórico).
  // Solo aplica a marcas generadas (grilla rápida); las marcas embebidas en
  // el PDF de fondo no se pueden quitar desde acá.
  const drawMarks = options.drawMarks !== false;
  // rotateContent180: gira cada imagen 180° dentro de su celda. Lo usamos en el
  // dorso de la grilla doble faz con volteo arriba-abajo (backFlip: 'tb'): la
  // hoja se gira sobre el eje horizontal, asi que el contenido del dorso, que
  // se imprime derecho, saldria cabeza abajo. Lo pre-rotamos para compensar.
  const rotate180 = options.rotateContent180 === true;
  const { imageMap, embedCache } = ctx;

  const templateWpt = template.pageWidthMm * MM_TO_PT;
  const templateHpt = template.pageHeightMm * MM_TO_PT;
  const pageW = paperWmm * MM_TO_PT;
  const pageH = paperHmm * MM_TO_PT;
  const offsetXpt = (pageW - templateWpt) / 2;
  const offsetYpt = (pageH - templateHpt) / 2;

  let bgPage = null;
  if (embedBackground && template.pdfBase64) {
    if (ctx.bgPageCache) {
      bgPage = ctx.bgPageCache;
    } else {
      try {
        const bytes = base64ToBytes(template.pdfBase64);
        [bgPage] = await doc.embedPdf(bytes, [0]);
        ctx.bgPageCache = bgPage;
      } catch (err) {
        console.error('No se pudo embeber pag 1 del PDF de plantilla:', err);
      }
    }
  }

  async function embedFull(image) {
    const key = `full:${image.id}`;
    if (embedCache.has(key)) return embedCache.get(key);
    const bytes = dataUrlToBytes(image.dataUrl);
    const mime = detectMime(image.dataUrl, image.mime);
    const embedded = mime.includes('png')
      ? await doc.embedPng(bytes)
      : await doc.embedJpg(bytes);
    embedCache.set(key, embedded);
    return embedded;
  }

  async function embedCoverCrop(image, cellW, cellH) {
    const aspectKey = `${cellW.toFixed(3)}x${cellH.toFixed(3)}`;
    const key = `cover:${image.id}:${aspectKey}`;
    if (embedCache.has(key)) return embedCache.get(key);
    const rect = coverCropRect(image, cellW, cellH);
    if (!rect) return embedFull(image);
    const cropped = await cropImageDataUrl(
      image.dataUrl,
      rect,
      image.width,
      image.height,
    );
    const bytes = dataUrlToBytes(cropped);
    const mime = detectMime(cropped, 'image/png');
    const embedded = mime.includes('png')
      ? await doc.embedPng(bytes)
      : await doc.embedJpg(bytes);
    embedCache.set(key, embedded);
    return embedded;
  }

  const isMulti = fixedPageCount(template) !== null;
  // Para multi-page: cada hoja tiene sus propias celdas; pageCount fijo.
  // Para legacy: las mismas celdas se repiten; pageCount sale del array.
  let pageCount;
  if (isMulti) {
    pageCount = fixedPageCount(template);
  } else {
    const cellsLen = cellPositions(template, face).length;
    const total = assignments?.length ?? 0;
    pageCount = Math.max(1, Math.ceil(total / Math.max(1, cellsLen)));
  }

  for (let p = 0; p < pageCount; p++) {
    const cells = isMulti
      ? cellsForPage(template, p, face)
      : cellPositions(template, face);
    const offset = isMulti
      ? pageStartOffset(template, p, face)
      : p * cells.length;

    const page = doc.addPage([pageW, pageH]);

    if (bgPage) {
      page.drawPage(bgPage, {
        x: offsetXpt,
        y: offsetYpt,
        width: templateWpt,
        height: templateHpt,
      });
    } else if (
      drawMarks
      && typeof template.markMarginMm === 'number'
      && template.markMarginMm > 0
      && Array.isArray(template.cortes)
      && template.cortes.length > 0
      && !(template.doubleSided && face === 'back')
    ) {
      // Plantillas sin fondo propio que SI van a cortarse en plotter (grilla
      // rapida con cortes generados): dibujamos las marcas L para que el
      // plotter pueda escanearlas. La negacion del dorso doble-faz evita
      // dibujarlas dos veces (el frente de doble-faz ya las trae embebidas
      // en el PDF original). En grillas no doubleSided el face default cae
      // en 'back' por la logica vieja, pero como NO hay distincion de caras,
      // igual queremos las marcas.
      drawCornerMarks(page, {
        offsetXpt,
        offsetYpt,
        templateWpt,
        templateHpt,
        markMarginMm: template.markMarginMm,
      });
    }

    // Borde blanco uniforme alrededor de cada foto. El corte/celda NO cambia de
    // tamaño: la foto se dibuja dentro de un rectángulo interior y el gap queda
    // blanco. 0 (o ausente) = comportamiento de siempre.
    const borderMm = Math.max(0, Number(template.cellWhiteBorderMm) || 0);
    // Línea de marco: filete de color dibujado sobre el borde EXTERIOR de la
    // celda (el borde de la tarjeta). 0 = sin línea.
    const lineMm = Math.max(0, Number(template.cellBorderLineMm) || 0);
    const lineRgb = hexToRgb(template.cellBorderColor);

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const imgId = assignments?.[offset + i];
      if (!imgId) continue;
      const image = imageMap.get(imgId);
      if (!image) continue;

      const cellWpt = cell.w * MM_TO_PT;
      const cellHpt = cell.h * MM_TO_PT;
      // Clamp del borde para que el interior nunca quede en cero o negativo.
      const bMm = borderMm > 0
        ? Math.min(borderMm, Math.max(0, Math.min(cell.w, cell.h) / 2 - 0.2))
        : 0;
      const innerWmm = cell.w - 2 * bMm;
      const innerHmm = cell.h - 2 * bMm;
      const innerWpt = innerWmm * MM_TO_PT;
      const innerHpt = innerHmm * MM_TO_PT;
      const bPt = bMm * MM_TO_PT;
      const cellXpt = cell.x * MM_TO_PT + offsetXpt;
      const cellBottomYpt = pageH - offsetYpt - cell.y * MM_TO_PT - cellHpt;
      // Esquina inferior-izquierda del rect INTERIOR (coords pdf, Y hacia arriba).
      const baseX = cellXpt + bPt;
      const baseYBottom = cellBottomYpt + bPt;
      const cellFitMode = image.fitOverride ?? layoutFitMode;

      // Fondo blanco del marco: cubre la celda entera (incluido un eventual
      // fondo de PDF) para que el borde quede blanco de verdad.
      if (bMm > 0) {
        page.drawRectangle({
          x: cellXpt,
          y: cellBottomYpt,
          width: cellWpt,
          height: cellHpt,
          color: rgb(1, 1, 1),
        });
      }

      if (cellFitMode === 'cover') {
        const embedded = await embedCoverCrop(image, innerWmm, innerHmm);
        // Al rotar 180° el ancla (x,y) de pdf-lib queda en la esquina opuesta,
        // por eso desplazamos al vertice superior-derecho del rectangulo.
        page.drawImage(embedded, {
          x: rotate180 ? baseX + innerWpt : baseX,
          y: rotate180 ? baseYBottom + innerHpt : baseYBottom,
          width: innerWpt,
          height: innerHpt,
          rotate: rotate180 ? degrees(180) : undefined,
        });
      } else {
        const embedded = await embedFull(image);
        const { drawW, drawH, dx, dy } = fitContain(
          innerWpt,
          innerHpt,
          embedded.width,
          embedded.height,
        );
        const drawX = baseX + dx;
        const drawY = baseYBottom + dy;
        page.drawImage(embedded, {
          x: rotate180 ? drawX + drawW : drawX,
          y: rotate180 ? drawY + drawH : drawY,
          width: drawW,
          height: drawH,
          rotate: rotate180 ? degrees(180) : undefined,
        });
      }

      // Línea de marco sobre el borde exterior de la celda. Se dibuja DESPUÉS de
      // la foto (queda encima) y se mete media línea hacia adentro para que el
      // trazo entre completo dentro de la tarjeta. Es simétrica, no necesita
      // rotación para el dorso.
      if (lineMm > 0) {
        const lwPt = lineMm * MM_TO_PT;
        const half = lwPt / 2;
        page.drawRectangle({
          x: cellXpt + half,
          y: cellBottomYpt + half,
          width: cellWpt - lwPt,
          height: cellHpt - lwPt,
          borderColor: lineRgb,
          borderWidth: lwPt,
        });
      }
    }
  }
}

export async function buildPdf(template, assignments, imageMap, options = {}) {
  const layoutFitMode = options.layoutFitMode ?? 'contain';
  // embedBackground: si true, pone la pag 1 del PDF (marcas) detras de las
  // imagenes. Default true (frente). Para imprimir el dorso pasamos false:
  // las imagenes salen sin marcas pero en las mismas coordenadas, asi al
  // dar vuelta la hoja caen sobre las celdas correctas.
  const embedBackground = options.embedBackground !== false;
  // Si el papel fisico es mayor (o menor) que la plantilla, la hoja queda
  // al tamano del papel y el contenido (incluido el fondo de marcas) se
  // centra. Asi, en doble faz, frente y dorso comparten el mismo centro
  // fisico y al voltear quedan alineados aunque el papel sea distinto.
  const paperWmm = options.paperWidthMm ?? template.pageWidthMm;
  const paperHmm = options.paperHeightMm ?? template.pageHeightMm;
  const face = options.face ?? (embedBackground ? 'front' : 'back');

  const doc = await PDFDocument.create();
  doc.setTitle(template.name || 'PrintLayout');
  doc.setProducer('PrintLayout');
  doc.setCreator('PrintLayout');

  const ctx = { imageMap, embedCache: new Map(), bgPageCache: null };
  await appendFaceToDoc(doc, ctx, template, assignments, {
    layoutFitMode,
    embedBackground,
    face,
    paperWmm,
    paperHmm,
    drawMarks: options.drawMarks,
    // Rotacion del dorso: independiente del espejo de posicion. La controla el
    // flag backRotate180 de la plantilla (toggle "Rotar dorso" en la UI).
    rotateContent180: face === 'back' && template.doubleSided && backRotate180(template),
  });

  return doc.save();
}

// Para plantillas doble faz: genera un unico PDF con frente (pag 1, con marcas)
// + dorso (pag 2, sin marcas). Las imagenes que aparezcan en ambas caras se
// embeben una sola vez gracias al embedCache compartido.
export async function buildDoubleSidedPdf(
  template,
  assignmentsFront,
  assignmentsBack,
  imageMap,
  options = {},
) {
  const layoutFitMode = options.layoutFitMode ?? 'contain';
  const paperWmm = options.paperWidthMm ?? template.pageWidthMm;
  const paperHmm = options.paperHeightMm ?? template.pageHeightMm;

  const doc = await PDFDocument.create();
  doc.setTitle(template.name || 'PrintLayout');
  doc.setProducer('PrintLayout');
  doc.setCreator('PrintLayout');

  const ctx = { imageMap, embedCache: new Map(), bgPageCache: null };
  await appendFaceToDoc(doc, ctx, template, assignmentsFront, {
    layoutFitMode,
    embedBackground: true,
    face: 'front',
    paperWmm,
    paperHmm,
    drawMarks: options.drawMarks,
  });
  await appendFaceToDoc(doc, ctx, template, assignmentsBack, {
    layoutFitMode,
    embedBackground: false,
    face: 'back',
    paperWmm,
    paperHmm,
    // Rotacion del dorso: independiente del espejo de posicion (flag
    // backRotate180, toggle "Rotar dorso" en la UI).
    rotateContent180: backRotate180(template),
  });

  return doc.save();
}

function safePdfName(template, options = {}) {
  const safe =
    (template.name || 'PrintLayout').replace(/[\\/:*?"<>|]+/g, '_').trim() ||
    'PrintLayout';
  const suffix = options.faceLabel ? ` - ${options.faceLabel}` : '';
  return `${safe}${suffix}.pdf`;
}

export async function exportLayoutToPdf(template, assignments, imageMap, options) {
  const bytes = await buildPdf(template, assignments, imageMap, options);
  const result = await window.printlayout.pdf.save(safePdfName(template, options), bytes);
  return result;
}

export async function exportDoubleSidedLayoutToPdf(
  template,
  assignmentsFront,
  assignmentsBack,
  imageMap,
  options,
) {
  const bytes = await buildDoubleSidedPdf(
    template,
    assignmentsFront,
    assignmentsBack,
    imageMap,
    options,
  );
  const result = await window.printlayout.pdf.save(
    safePdfName(template, options),
    bytes,
  );
  return result;
}

export async function printLayoutPdf(template, assignments, imageMap, options) {
  const bytes = await buildPdf(template, assignments, imageMap, options);
  // Rasterizamos con pdfjs para mandarle PNG por hoja al PrintHelper nativo.
  // Por default mandamos showDialog:false para impresion silent (el caller
  // ya eligio impresora+copias en nuestro PrintModal). El helper aplica el
  // DEVMODE guardado por PrintLayout para esta impresora sin tocar el del
  // sistema.
  const dpi = options?.printDpi ?? 240;
  const allImages = await renderPdfBytesToImages(bytes, dpi);
  // Si el caller pidio solo un subconjunto de paginas (indices 0-based),
  // filtramos. Indices fuera de rango se ignoran.
  let images = allImages;
  if (Array.isArray(options?.pages) && options.pages.length > 0) {
    images = options.pages
      .map((idx) => allImages[idx])
      .filter((img) => !!img);
    if (images.length === 0) {
      return { ok: false, error: 'No hay páginas válidas para imprimir.' };
    }
  }
  const paperWidthMm = options?.paperWidthMm ?? template.pageWidthMm;
  const paperHeightMm = options?.paperHeightMm ?? template.pageHeightMm;
  const result = await window.printlayout.pdf.print({
    defaultName: safePdfName(template, options),
    images,
    pageWidthMm: paperWidthMm,
    pageHeightMm: paperHeightMm,
    deviceName: options?.deviceName,
    copies: options?.copies,
    showDialog: options?.showDialog,
  });
  return result;
}

// Por completitud, no se usa todavia: podriamos exponer "el ojo" del cover.
export { coverObjectPosition };
