import { PDFDocument, rgb, cmyk, degrees, StandardFonts } from 'pdf-lib';
import qrcode from 'qrcode-generator';
import {
  cellPositions,
  cellsForPage,
  pageStartOffset,
  fixedPageCount,
  backRotate180,
  cutIdForPage,
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

// 4 marcas de registro en las esquinas de la HOJA FÍSICA. Las usa el plotter
// A3 Max 4 Pro para alinear el corte ópticamente. Se dibujan solo cuando la
// plantilla no tiene fondo propio (grilla rápida, auto-pack) y `markMarginMm>0`.
//
// IMPORTANTE — van contra la HOJA física (pageWpt/pageHpt), NO contra la
// plantilla: el .plt (send_to_plotter) calcula la ventana como hoja − 2×margen,
// así que si las marcas se ubicaran contra la plantilla (centrada en una hoja
// más grande) el corte saldría corrido. Misma verdad que el QR (qrPlacementMm).
//
// markType:
//   'circle' (default) = círculo relleno Ø5mm (radio 2,5mm), negro K puro,
//                        con disco blanco de 9mm detrás (resguardo, como el QR),
//                        que coincide con CMD:103,5 del plugin de Corel.
//   'L'                = marcas L de antes (brazo 10mm, trazo 0.3mm) = CMD:103,0.
//                        Se deja seleccionable para poder volver atrás.
export function drawRegistrationMarks(page, {
  pageWpt, pageHpt, markMarginMm, markType = 'circle',
}) {
  if (!markMarginMm || markMarginMm <= 0) return;
  const m = markMarginMm * MM_TO_PT;

  // Centros de las marcas: a `markMarginMm` de cada borde de la hoja física.
  // En coords PDF (Y arriba). top = Y alta, bottom = Y baja.
  const left = m;
  const right = pageWpt - m;
  const top = pageHpt - m;
  const bottom = m;
  if (right <= left || top <= bottom) return;

  const corners = [
    [left, top], [right, top], [left, bottom], [right, bottom],
  ];
  // Negro de UNA sola tinta (K puro), no cuatro tintas → registro limpio.
  const black = cmyk(0, 0, 0, 1);

  if (markType === 'L') {
    const arm = 10 * MM_TO_PT;
    const thickness = 0.3 * MM_TO_PT;
    const line = (x1, y1, x2, y2) => page.drawLine({
      start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color: black,
    });
    // Cada brazo apunta hacia adentro del área.
    line(left, top, left + arm, top);
    line(left, top, left, top - arm);
    line(right, top, right - arm, top);
    line(right, top, right, top - arm);
    line(left, bottom, left + arm, bottom);
    line(left, bottom, left, bottom + arm);
    line(right, bottom, right - arm, bottom);
    line(right, bottom, right, bottom + arm);
    return;
  }

  // Círculos (default): en pdf-lib `size` es el RADIO.
  const radiusPt = 2.5 * MM_TO_PT;       // Ø 5 mm
  const guardPt = 4.5 * MM_TO_PT;        // disco blanco Ø 9 mm (2 mm de resguardo)
  // Primero todos los discos blancos, después los círculos negros (así ninguno
  // tapa a otro si el margen fuera muy chico y llegaran a solaparse).
  for (const [x, y] of corners) {
    page.drawCircle({ x, y, size: guardPt, color: rgb(1, 1, 1) });
  }
  for (const [x, y] of corners) {
    page.drawCircle({ x, y, size: radiusPt, color: black });
  }
}

// Marcas L clásicas ubicadas contra el ÁREA dada (offset + tamaño). La usa el
// export de Rótulos, que arma su propio layout y las quiere contra su caja. El
// print-and-cut de grilla/auto-pack usa drawRegistrationMarks (círculos, contra
// la hoja física). Brazo 10 mm, trazo 0.3 mm, negro.
export function drawCornerMarks(page, {
  offsetXpt, offsetYpt, templateWpt, templateHpt, markMarginMm,
}) {
  if (!markMarginMm || markMarginMm <= 0) return;
  const m = markMarginMm * MM_TO_PT;
  const arm = 10 * MM_TO_PT;
  const thickness = 0.3 * MM_TO_PT;
  const color = rgb(0, 0, 0);

  const left = offsetXpt + m;
  const right = offsetXpt + templateWpt - m;
  const top = offsetYpt + templateHpt - m;
  const bottom = offsetYpt + m;
  if (right <= left || top <= bottom) return;

  const line = (x1, y1, x2, y2) => page.drawLine({
    start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color,
  });
  line(left, top, left + arm, top);
  line(left, top, left, top - arm);
  line(right, top, right - arm, top);
  line(right, top, right, top - arm);
  line(left, bottom, left + arm, bottom);
  line(left, bottom, left, bottom + arm);
  line(right, bottom, right - arm, bottom);
  line(right, bottom, right, bottom + arm);
}

// Posición del QR en la HOJA física, en mm. ÚNICA fuente de la fórmula: la usan
// tanto el PDF (drawQr) como la vista previa del canvas, así coinciden.
// Devuelve el borde IZQUIERDO (xLeftMm) y el borde INFERIOR del QR medido desde
// el borde inferior de la hoja (yBottomMm). Centro vertical del QR = `bottomMm`.
export function qrPlacementMm({ pageWmm, sizeMm = 8, bottomMm = 9.5, centered = true }) {
  const xLeftMm = centered ? (pageWmm - sizeMm) / 2 : 10;
  const yBottomMm = bottomMm - sizeMm / 2;
  return { xLeftMm, yBottomMm, sizeMm };
}

// Matriz del QR para `text` (qrcode-generator, corrección 'M'). Compartida por
// el PDF y el canvas para que dibujen exactamente el mismo QR.
export function qrMatrix(text) {
  const qr = qrcode(0, 'M'); // typeNumber 0 = auto
  qr.addData(String(text));
  qr.make();
  const n = qr.getModuleCount();
  const cells = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cells.push([r, c]);
  return { n, cells };
}

// Dibuja un QR VECTORIAL (nítido a cualquier DPI) en la HOJA física. El QR
// contiene SOLO el texto `text` (= nombre del corte), igual que en busca2: la
// cámara del cabezal lo lee y el server QR sirve <text>.plt. La posición es
// relativa a la hoja física (pageWmm/pageHmm), NO al área de la plantilla.
// Sin `text` → no dibuja nada (los callers actuales no pasan qr → todo igual).
export function drawQr(page, {
  text, pageWmm, sizeMm = 8, bottomMm = 9.5, centered = true, showText = false, font = null,
}) {
  if (!text) return;
  const { n, cells } = qrMatrix(text);
  const { xLeftMm, yBottomMm } = qrPlacementMm({ pageWmm, sizeMm, bottomMm, centered });
  const sizePt = sizeMm * MM_TO_PT;
  const moduleSz = sizePt / n;
  const xLeftPt = xLeftMm * MM_TO_PT;
  const yBottomPt = yBottomMm * MM_TO_PT;

  // Quiet zone: recuadro blanco ~1mm alrededor ANTES de los módulos (contraste
  // para el escáner, por si abajo hubiera arte o color).
  const quietPt = 1 * MM_TO_PT;
  page.drawRectangle({
    x: xLeftPt - quietPt,
    y: yBottomPt - quietPt,
    width: sizePt + 2 * quietPt,
    height: sizePt + 2 * quietPt,
    color: rgb(1, 1, 1),
  });

  // Módulos oscuros. La matriz tiene la fila 0 ARRIBA; en PDF la Y crece hacia
  // arriba, así que invertimos la fila al mapear.
  for (const [r, c] of cells) {
    page.drawRectangle({
      x: xLeftPt + c * moduleSz,
      y: yBottomPt + (n - 1 - r) * moduleSz,
      width: moduleSz,
      height: moduleSz,
      color: rgb(0, 0, 0),
    });
  }

  // Texto opcional a la DERECHA del QR, centrado vertical (como el print de Corel).
  if (showText && font) {
    const fontSize = 7.5;
    const tx = xLeftPt + sizePt + quietPt + 2 * MM_TO_PT;
    const ty = yBottomPt + sizePt / 2 - fontSize * 0.35;
    page.drawText(String(text), { x: tx, y: ty, size: fontSize, font, color: rgb(0, 0, 0) });
  }
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
  const { layoutFitMode, embedBackground, face, paperWmm, paperHmm, qr } = options;
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

  // Fondo POR HOJA: cada hoja embebe el fondo de SU plantilla. En multi-page,
  // `template.pages[p].pdfBase64` puede traer un fondo propio (ej. combo Dobble:
  // hojas de cartas con un fondo, hoja de caja con otro). Se cachea por clave
  // (`bgKey` o el propio base64) para no re-embeber el mismo fondo. Sin fondo
  // per-page, cae al `template.pdfBase64` de siempre (misma hoja en todas).
  async function backgroundForPage(p) {
    if (!embedBackground) return null;
    const perPage = isMulti ? (template.pages?.[p] || null) : null;
    const b64 = (perPage && perPage.pdfBase64) || template.pdfBase64;
    if (!b64) return null;
    const key = (perPage && perPage.pdfBase64)
      ? (perPage.bgKey || perPage.pdfBase64)
      : '__tpl__';
    if (ctx.bgCache.has(key)) return ctx.bgCache.get(key);
    let embedded = null;
    try {
      [embedded] = await doc.embedPdf(base64ToBytes(b64), [0]);
    } catch (err) {
      console.error('No se pudo embeber el fondo de la hoja:', err);
    }
    ctx.bgCache.set(key, embedded);
    return embedded;
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

  // Fuente para el texto del QR (si se pide). Se embebe una sola vez por doc.
  let qrFont = null;
  if (qr && qr.text && qr.showText) {
    qrFont = await doc.embedFont(StandardFonts.Helvetica);
  }

  for (let p = 0; p < pageCount; p++) {
    const cells = isMulti
      ? cellsForPage(template, p, face)
      : cellPositions(template, face);
    const offset = isMulti
      ? pageStartOffset(template, p, face)
      : p * cells.length;

    const page = doc.addPage([pageW, pageH]);

    const bgPage = await backgroundForPage(p);
    if (bgPage) {
      page.drawPage(bgPage, {
        x: offsetXpt,
        y: offsetYpt,
        width: templateWpt,
        height: templateHpt,
      });
    }

    // ¿Dibujar marcas de registro propias? Solo para plantillas SIN fondo propio
    // (grilla rápida / auto-pack con cortes generados) que van a cortarse en
    // plotter. Con fondo de PDF las marcas ya vienen embebidas. La negación del
    // dorso doble-faz evita dibujarlas dos veces. Se DIBUJAN AL FINAL (después de
    // las imágenes) para que ninguna celda de esquina las tape — ver abajo.
    const shouldDrawMarks = !bgPage
      && drawMarks
      && typeof template.markMarginMm === 'number'
      && template.markMarginMm > 0
      && Array.isArray(template.cortes)
      && template.cortes.length > 0
      && !(template.doubleSided && face === 'back');

    // El marco (borde blanco + línea de filete) se resuelve POR-IMAGEN adentro
    // del loop: image.frame pisa el valor de plantilla campo por campo; si no hay
    // override, hereda el de la plantilla (comportamiento de siempre).
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const imgId = assignments?.[offset + i];
      if (!imgId) continue;
      const image = imageMap.get(imgId);
      if (!image) continue;

      // Borde blanco ("passe-partout"): encoge la foto a un rect interior y pinta
      // el resto de blanco. 0 (o ausente) = sin borde.
      const borderMm = Math.max(0, Number(image.frame?.whiteBorderMm ?? template.cellWhiteBorderMm) || 0);
      // Línea de filete: marco de color fino sobre el borde EXTERIOR de la celda.
      const lineMm = Math.max(0, Number(image.frame?.lineMm ?? template.cellBorderLineMm) || 0);
      const lineRgb = hexToRgb(image.frame?.color ?? template.cellBorderColor);

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

    // QR de corte (SOLO frente): una vez por hoja, en la franja inferior de la
    // hoja física. La cámara del cabezal lo lee y pide <text>.plt. Si la plantilla
    // tiene cortes DISTINTOS por hoja (cortesPorPagina), cada hoja lleva su
    // PROPIO QR (base, base-h2, base-h3…) → escaneás cada hoja y corta la suya.
    // Si el corte es el mismo en todas (grillas, por-tamaño), va el mismo QR.
    // Ausente (callers actuales) → no dibuja nada.
    const qrTextForThisPage = qr && qr.text
      ? (cutIdForPage(template, p) || qr.text)
      : null;
    if (qrTextForThisPage && !(template.doubleSided && face === 'back')) {
      drawQr(page, {
        text: qrTextForThisPage,
        pageWmm: paperWmm,
        pageHmm: paperHmm,
        sizeMm: qr.sizeMm,
        bottomMm: qr.bottomMm,
        centered: qr.centered,
        showText: qr.showText,
        font: qrFont,
      });
    }

    // Marcas de registro AL FINAL, sobre todo lo demás (imágenes incluidas), para
    // que una celda de esquina no las tape. Van contra la HOJA física y con su
    // disco blanco de resguardo detrás (ver drawRegistrationMarks). No colisionan
    // con el QR (esquinas vs. centro-inferior).
    if (shouldDrawMarks) {
      drawRegistrationMarks(page, {
        pageWpt: pageW,
        pageHpt: pageH,
        markMarginMm: template.markMarginMm,
        markType: template.markType === 'L' ? 'L' : 'circle',
      });
    }
  }
}

// Cuenta las páginas de un PDF ya generado (bytes). Sirve para verificar, antes
// de dar un pedido por procesado, que el PDF salió con la cantidad de páginas
// esperada (no vacío ni truncado). Devuelve 0 si los bytes no son un PDF válido.
export async function countPdfPages(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
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

  const ctx = { imageMap, embedCache: new Map(), bgCache: new Map() };
  await appendFaceToDoc(doc, ctx, template, assignments, {
    layoutFitMode,
    embedBackground,
    face,
    paperWmm,
    paperHmm,
    drawMarks: options.drawMarks,
    qr: options.qr,
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

  const ctx = { imageMap, embedCache: new Map(), bgCache: new Map() };
  await appendFaceToDoc(doc, ctx, template, assignmentsFront, {
    layoutFitMode,
    embedBackground: true,
    face: 'front',
    paperWmm,
    paperHmm,
    drawMarks: options.drawMarks,
    qr: options.qr, // el QR va SOLO en el frente
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
  // Calibración de tamaño de impresión: escalamos los mm que le pasamos al
  // helper (que dibuja a esos mm y centra). Así el tamaño físico calza con el
  // corte del plotter (que va a mm exactos) aunque la impresora saque un poco
  // más chico. 1 = sin ajuste. Escala uniforme → preserva el aspecto y el centro.
  const printScale = Number(options?.printScale) > 0 ? Number(options.printScale) : 1;
  const paperWidthMm = (options?.paperWidthMm ?? template.pageWidthMm) * printScale;
  const paperHeightMm = (options?.paperHeightMm ?? template.pageHeightMm) * printScale;
  const result = await window.printlayout.pdf.print({
    defaultName: safePdfName(template, options),
    // Nombre del trabajo en la cola de la impresora (ej. "PC 1 - Grilla rápida").
    docName: options?.docName,
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
