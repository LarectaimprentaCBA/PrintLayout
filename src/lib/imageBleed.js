// Metodos de extension de imagen para agregar sangrado/bleed antes de imprimir.
//
// Todas las funciones reciben:
//   dataUrl       — imagen fuente (PNG o JPEG dataUrl).
//   srcSizeMm     — { w, h } tamano fisico que el usuario declara que tiene la imagen.
//   targetSizeMm  — { w, h } tamano fisico al que se quiere llevar.
//   options       — especifico por metodo.
//
// Todas devuelven { dataUrl, width, height, sizeMm }.
//
// Diseno comun:
// - Se respeta el aspect del bitmap. Si el aspect declarado (srcSizeMm) no coincide
//   con el aspect del archivo, la imagen NO se distorsiona: se usa la densidad mas
//   alta de pxPerMm y la imagen queda centrada con gaps que el metodo de bleed
//   rellena segun su logica.
// - Salida en PNG para preservar el snap-a-blanco-puro de normalizeImageToSrgb
//   (igual que el resto del pipeline).

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen.'));
    img.src = dataUrl;
  });
}

// Capa fina sobre HTMLImageElement: calcula canvas final + posicion donde
// dibujar la imagen sin distorsion. drawW/drawH son los pixeles reales con
// los que se va a dibujar; pxPerMm es la densidad efectiva.
//
// Si la imagen es mas CHICA que el target: la imagen queda centrada con
// drawX/drawY > 0 (gap para el bleed).
// Si la imagen es mas GRANDE que el target: se escala hacia abajo (preserva
// aspect) para que entre adentro del target. drawW/drawH < sw/sh; el bleed
// rellena el espacio restante igual que en el caso chico.
function computeLayout(img, srcSizeMm, targetSizeMm) {
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  if (!Number.isFinite(srcSizeMm?.w) || !Number.isFinite(srcSizeMm?.h)
      || srcSizeMm.w <= 0 || srcSizeMm.h <= 0) {
    throw new Error('srcSizeMm invalido.');
  }
  if (!Number.isFinite(targetSizeMm?.w) || !Number.isFinite(targetSizeMm?.h)
      || targetSizeMm.w <= 0 || targetSizeMm.h <= 0) {
    throw new Error('targetSizeMm invalido.');
  }
  // Densidad base del archivo: max() entre las dos posibles para no perder
  // calidad cuando el aspect declarado y el del archivo difieren.
  const pxPerMmBase = Math.max(sw / srcSizeMm.w, sh / srcSizeMm.h);
  // Si la imagen declarada excede el target en alguno de los dos lados,
  // escalamos el tamano efectivo para que entre. fitScale <= 1.
  const fitScale = Math.min(
    1,
    targetSizeMm.w / srcSizeMm.w,
    targetSizeMm.h / srcSizeMm.h,
  );
  // Subir pxPerMm cuando hay que fittear hace que el mismo bitmap ocupe
  // menos mm fisicos en el canvas, sin tocar drawW/drawH (= sw/sh). Asi
  // la matematica de 9-slice (que mapea pixels src a pixels dst) sigue
  // funcionando 1:1.
  const pxPerMm = pxPerMmBase / fitScale;
  const canvasW = Math.max(1, Math.round(targetSizeMm.w * pxPerMm));
  const canvasH = Math.max(1, Math.round(targetSizeMm.h * pxPerMm));
  const drawW = sw;
  const drawH = sh;
  const drawX = Math.round((canvasW - drawW) / 2);
  const drawY = Math.round((canvasH - drawH) / 2);
  return { sw, sh, pxPerMm, canvasW, canvasH, drawW, drawH, drawX, drawY, fitScale };
}

function makeCanvas(canvasW, canvasH) {
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  // Suavizado de alta calidad cuando hay que escalar (downsample/upsample).
  // Default Chromium = 'low' (bilineal) -> borroso. 'high' usa un filtro mejor
  // (tipo lanczos/bicubico) y produce imagenes nitidas.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

function output(canvas, targetSizeMm) {
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    sizeMm: { w: targetSizeMm.w, h: targetSizeMm.h },
  };
}

// ----------------------------------------------------------------------------
// 1) Mirror — refleja los bordes de la imagen hacia afuera.
//
// Estrategia: dibuja la imagen 9 veces (centro + 4 lados + 4 esquinas) con los
// flips apropiados; los excesos quedan fuera del canvas y se clippean. Es el
// metodo mas robusto para fondos con textura natural.
// ----------------------------------------------------------------------------
export async function extendMirror(dataUrl, srcSizeMm, targetSizeMm) {
  const img = await loadImage(dataUrl);
  const { canvasW, canvasH, drawW, drawH, drawX, drawY } =
    computeLayout(img, srcSizeMm, targetSizeMm);
  const { canvas, ctx } = makeCanvas(canvasW, canvasH);

  // sx/sy: -1 = flip en ese eje, 1 = identidad.
  const tiles = [
    { dx: drawX - drawW, dy: drawY - drawH, sx: -1, sy: -1 }, // TL
    { dx: drawX,         dy: drawY - drawH, sx:  1, sy: -1 }, // T
    { dx: drawX + drawW, dy: drawY - drawH, sx: -1, sy: -1 }, // TR
    { dx: drawX - drawW, dy: drawY,         sx: -1, sy:  1 }, // L
    { dx: drawX + drawW, dy: drawY,         sx: -1, sy:  1 }, // R
    { dx: drawX - drawW, dy: drawY + drawH, sx: -1, sy: -1 }, // BL
    { dx: drawX,         dy: drawY + drawH, sx:  1, sy: -1 }, // B
    { dx: drawX + drawW, dy: drawY + drawH, sx: -1, sy: -1 }, // BR
  ];
  for (const t of tiles) {
    ctx.save();
    // Traslada al centro de la celda destino, escala con sx/sy, dibuja centrado.
    ctx.translate(t.dx + drawW / 2, t.dy + drawH / 2);
    ctx.scale(t.sx, t.sy);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }
  // Centro (sin transform).
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  return output(canvas, targetSizeMm);
}

// ----------------------------------------------------------------------------
// 2) Edge replicate ancho — toma una franja de stripPx pixeles del borde y la
// estira perpendicular para rellenar el bleed. Mejor que el de 1 px porque
// preserva variacion local del color/textura.
// ----------------------------------------------------------------------------
export async function extendEdgeReplicate(
  dataUrl, srcSizeMm, targetSizeMm, { stripPx = 8 } = {},
) {
  const img = await loadImage(dataUrl);
  const { sw, sh, canvasW, canvasH, drawW, drawH, drawX, drawY } =
    computeLayout(img, srcSizeMm, targetSizeMm);
  const { canvas, ctx } = makeCanvas(canvasW, canvasH);

  const strip = Math.max(1, Math.min(stripPx, Math.floor(Math.min(sw, sh) / 2)));
  const rightGap = canvasW - (drawX + drawW);
  const bottomGap = canvasH - (drawY + drawH);

  // Strips de borde (estirados hacia afuera).
  if (drawY > 0) {
    // Top: source = img(0,0,sw,strip), dest = (drawX, 0, drawW, drawY)
    ctx.drawImage(img, 0, 0, sw, strip, drawX, 0, drawW, drawY);
  }
  if (bottomGap > 0) {
    ctx.drawImage(img, 0, sh - strip, sw, strip, drawX, drawY + drawH, drawW, bottomGap);
  }
  if (drawX > 0) {
    ctx.drawImage(img, 0, 0, strip, sh, 0, drawY, drawX, drawH);
  }
  if (rightGap > 0) {
    ctx.drawImage(img, sw - strip, 0, strip, sh, drawX + drawW, drawY, rightGap, drawH);
  }
  // Esquinas: tile de strip x strip estirado.
  if (drawX > 0 && drawY > 0) {
    ctx.drawImage(img, 0, 0, strip, strip, 0, 0, drawX, drawY);
  }
  if (rightGap > 0 && drawY > 0) {
    ctx.drawImage(img, sw - strip, 0, strip, strip, drawX + drawW, 0, rightGap, drawY);
  }
  if (drawX > 0 && bottomGap > 0) {
    ctx.drawImage(img, 0, sh - strip, strip, strip, 0, drawY + drawH, drawX, bottomGap);
  }
  if (rightGap > 0 && bottomGap > 0) {
    ctx.drawImage(img, sw - strip, sh - strip, strip, strip,
      drawX + drawW, drawY + drawH, rightGap, bottomGap);
  }
  // Centro.
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  return output(canvas, targetSizeMm);
}

// ----------------------------------------------------------------------------
// 3) Color solido — pinta el canvas con un color y dibuja la imagen centrada
// arriba. color es un hex string '#rrggbb' o cualquier valor valido CSS.
// ----------------------------------------------------------------------------
export async function extendSolidColor(
  dataUrl, srcSizeMm, targetSizeMm, { color = '#ffffff' } = {},
) {
  const img = await loadImage(dataUrl);
  const { canvasW, canvasH, drawW, drawH, drawX, drawY } =
    computeLayout(img, srcSizeMm, targetSizeMm);
  const { canvas, ctx } = makeCanvas(canvasW, canvasH);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  return output(canvas, targetSizeMm);
}

// Helper para pipeta: lee el color de un pixel en la imagen (en coordenadas
// del dataUrl original). Devuelve '#rrggbb'.
export async function sampleColorAt(dataUrl, px, py) {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const x = Math.max(0, Math.min(canvas.width - 1, Math.round(px)));
  const y = Math.max(0, Math.min(canvas.height - 1, Math.round(py)));
  const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
  const hex = (n) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// ----------------------------------------------------------------------------
// 4) 9-slice — el rect central queda 1:1 (sin distorsion), los 8 sectores
// externos se estiran a sus zonas correspondientes en el target.
//
// centerRectMm = { x, y, w, h } en mm relativos al area srcSizeMm (origen
// top-left = esquina superior-izquierda de la imagen declarada).
//
// Bueno para tarjetas con marco/borde decorativo: el contenido central NO se
// deforma, solo se estira el marco.
// ----------------------------------------------------------------------------
export async function extendNineSlice(
  dataUrl, srcSizeMm, targetSizeMm, { centerRectMm } = {},
) {
  if (!centerRectMm) {
    throw new Error('extendNineSlice requiere centerRectMm.');
  }
  const img = await loadImage(dataUrl);
  const { sw, sh, pxPerMm, canvasW, canvasH, drawW, drawH, drawX, drawY } =
    computeLayout(img, srcSizeMm, targetSizeMm);
  const { canvas, ctx } = makeCanvas(canvasW, canvasH);

  // Center rect en pixeles del archivo. Coordenadas del centerRectMm son
  // relativas a srcSizeMm; las mapeamos al espacio de drawW/drawH centrado
  // sobre el canvas.
  // El factor mm->px del archivo es sw / srcSizeMm.w (o equivalente en H).
  // Como respetamos aspect, hay un pxPerMm unico, pero el centerRect viene en
  // coordenadas declaradas, asi que usamos sw/srcSizeMm.w para x y sh/srcSizeMm.h
  // para y (puede haber diferencia minima si aspect declarado != aspect real).
  const fx = sw / srcSizeMm.w;
  const fy = sh / srcSizeMm.h;
  // Source rect (en pixels del archivo).
  let srcCx = Math.round(centerRectMm.x * fx);
  let srcCy = Math.round(centerRectMm.y * fy);
  let srcCw = Math.round(centerRectMm.w * fx);
  let srcCh = Math.round(centerRectMm.h * fy);
  srcCx = Math.max(0, Math.min(sw - 1, srcCx));
  srcCy = Math.max(0, Math.min(sh - 1, srcCy));
  srcCw = Math.max(1, Math.min(sw - srcCx, srcCw));
  srcCh = Math.max(1, Math.min(sh - srcCy, srcCh));

  // Destination center rect en el canvas. Mantiene el tamano pixel del source
  // (1:1, sin escalar). Lo centramos relativo al centro del rect del source.
  // El centro del source (en su area declarada) cae en (centerRectMm.x + w/2,
  // centerRectMm.y + h/2) sobre srcSizeMm. Para mantener consistencia con la
  // imagen centrada, hacemos que el centro del dst rect caiga en el centro del
  // canvas trasladado igual.
  // Para simplificar y mantener el centro del rect del centro: ponemos el
  // dst center rect a la misma posicion logica que en el source, pero en el
  // espacio del target. El sector central NO escala, asi que dst dims = src dims.
  const dstCx = drawX + srcCx;
  const dstCy = drawY + srcCy;
  const dstCw = srcCw;
  const dstCh = srcCh;

  // Source: 9 sectores (left/center/right por cols; top/middle/bottom por rows).
  const sLeftW = srcCx;
  const sCentW = srcCw;
  const sRightW = sw - (srcCx + srcCw);
  const sTopH = srcCy;
  const sMidH = srcCh;
  const sBotH = sh - (srcCy + srcCh);

  // Destination: cada lado/esquina cubre el espacio entre dstCx/dstCy y los
  // bordes del canvas.
  const dLeftW = dstCx;
  const dCentW = dstCw;
  const dRightW = canvasW - (dstCx + dstCw);
  const dTopH = dstCy;
  const dMidH = dstCh;
  const dBotH = canvasH - (dstCy + dstCh);

  // 9 drawImage calls. Saltea los sectores degenerados.
  const draw = (sx, sy, sw_, sh_, dx, dy, dw, dh) => {
    if (sw_ <= 0 || sh_ <= 0 || dw <= 0 || dh <= 0) return;
    ctx.drawImage(img, sx, sy, sw_, sh_, dx, dy, dw, dh);
  };
  // Row 1 (top).
  draw(0,                  0,             sLeftW,  sTopH, 0,                  0,             dLeftW,  dTopH);
  draw(srcCx,              0,             sCentW,  sTopH, dstCx,              0,             dCentW,  dTopH);
  draw(srcCx + srcCw,      0,             sRightW, sTopH, dstCx + dstCw,      0,             dRightW, dTopH);
  // Row 2 (middle).
  draw(0,                  srcCy,         sLeftW,  sMidH, 0,                  dstCy,         dLeftW,  dMidH);
  draw(srcCx,              srcCy,         sCentW,  sMidH, dstCx,              dstCy,         dCentW,  dMidH);
  draw(srcCx + srcCw,      srcCy,         sRightW, sMidH, dstCx + dstCw,      dstCy,         dRightW, dMidH);
  // Row 3 (bottom).
  draw(0,                  srcCy + srcCh, sLeftW,  sBotH, 0,                  dstCy + dstCh, dLeftW,  dBotH);
  draw(srcCx,              srcCy + srcCh, sCentW,  sBotH, dstCx,              dstCy + dstCh, dCentW,  dBotH);
  draw(srcCx + srcCw,      srcCy + srcCh, sRightW, sBotH, dstCx + dstCw,      dstCy + dstCh, dRightW, dBotH);

  return output(canvas, targetSizeMm);
}

// ----------------------------------------------------------------------------
// 5) Shrink + bleed — encoge el contenido para que entre dentro de un area
// "interior" del target (tipicamente la zona segura o el corte), y rellena
// el espacio entre el contenido encogido y el borde del target con un metodo
// de bleed elegido (mirror / edge replicate / color).
//
// options:
//   shrinkPercent: 0–100 → que % del target ocupa el contenido (default 90).
//                  Si querés escalar para que entre exacto en el corte, pasa
//                  shrinkPercent calculado por el caller.
//   fillMode: 'mirror' | 'replicate' | 'color' (default 'mirror').
//   fillOptions: opciones especificas del fillMode (color, stripPx).
// ----------------------------------------------------------------------------
export async function extendShrinkAndBleed(
  dataUrl, srcSizeMm, targetSizeMm,
  { shrinkPercent = 90, fillMode = 'mirror', fillOptions = {} } = {},
) {
  const img = await loadImage(dataUrl);
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;

  // Calcular tamano del contenido encogido en mm, manteniendo aspect del file.
  const pct = Math.max(10, Math.min(100, shrinkPercent)) / 100;
  const fitWmm = targetSizeMm.w * pct;
  const fitHmm = targetSizeMm.h * pct;
  const aspect = sw / sh;
  let contentWmm = fitWmm;
  let contentHmm = fitWmm / aspect;
  if (contentHmm > fitHmm) {
    contentHmm = fitHmm;
    contentWmm = fitHmm * aspect;
  }

  // Trick: el archivo de imagen (sw x sh pixels) representa la "version
  // encogida" a contentMm. No hace falta rasterizar nada — solo redeclarar
  // su srcSizeMm a contentMm y dejar que el metodo de bleed haga su trabajo.
  // pxPerMm de la salida = sw/contentWmm = sh/contentHmm (siempre iguales
  // porque contentMm respeta el aspect del file). Asi el bitmap original se
  // usa a su resolucion completa, sin perder calidad.
  const newSrcMm = { w: contentWmm, h: contentHmm };
  switch (fillMode) {
    case 'replicate':
      return extendEdgeReplicate(dataUrl, newSrcMm, targetSizeMm, fillOptions);
    case 'color':
      return extendSolidColor(dataUrl, newSrcMm, targetSizeMm, fillOptions);
    case 'nineSlice': {
      const centerRectMm = fillOptions.centerRectMm ?? {
        x: contentWmm * 0.2,
        y: contentHmm * 0.2,
        w: contentWmm * 0.6,
        h: contentHmm * 0.6,
      };
      return extendNineSlice(dataUrl, newSrcMm, targetSizeMm, { centerRectMm });
    }
    case 'mirror':
    default:
      return extendMirror(dataUrl, newSrcMm, targetSizeMm);
  }
}

// ----------------------------------------------------------------------------
// 6) Crop — agranda la imagen mas alla del target y recorta lo que sobra.
//
// Util para logos con bordes blancos que querias "comerte": el contenido cae
// adentro del corte y los bordes se van fuera de la celda (se pierden al
// imprimir/cortar). cropPercent = 0 hace cover-fit (igual que background-size:
// cover). cropPercent > 0 escala extra hacia adentro.
// ----------------------------------------------------------------------------
export async function extendCrop(
  dataUrl, srcSizeMm, targetSizeMm, { cropPercent = 0 } = {},
) {
  const img = await loadImage(dataUrl);
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  // Resolucion del canvas: la maxima densidad pxPerMm del archivo, para no
  // perder calidad cuando los aspect declarados difieren.
  const pxPerMm = Math.max(sw / srcSizeMm.w, sh / srcSizeMm.h);
  const canvasW = Math.max(1, Math.round(targetSizeMm.w * pxPerMm));
  const canvasH = Math.max(1, Math.round(targetSizeMm.h * pxPerMm));
  const { canvas, ctx } = makeCanvas(canvasW, canvasH);
  // Cover-fit (escala minima que llena ambos lados) + extra zoom del recorte.
  const zoom = 1 + Math.max(0, cropPercent) / 100;
  const coverScale = Math.max(canvasW / sw, canvasH / sh);
  const drawScale = coverScale * zoom;
  const drawW = sw * drawScale;
  const drawH = sh * drawScale;
  const drawX = (canvasW - drawW) / 2;
  const drawY = (canvasH - drawH) / 2;
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  return output(canvas, targetSizeMm);
}

// ----------------------------------------------------------------------------
// Dispatcher convenientecome — recibe { method, ...options } y aplica.
// ----------------------------------------------------------------------------
export async function extendWithMethod(
  dataUrl, srcSizeMm, targetSizeMm, methodConfig,
) {
  const { method, ...opts } = methodConfig ?? {};
  switch (method) {
    case 'mirror': return extendMirror(dataUrl, srcSizeMm, targetSizeMm);
    case 'replicate': return extendEdgeReplicate(dataUrl, srcSizeMm, targetSizeMm, opts);
    case 'color': return extendSolidColor(dataUrl, srcSizeMm, targetSizeMm, opts);
    case 'nineSlice': return extendNineSlice(dataUrl, srcSizeMm, targetSizeMm, opts);
    case 'shrinkBleed': return extendShrinkAndBleed(dataUrl, srcSizeMm, targetSizeMm, opts);
    case 'crop': return extendCrop(dataUrl, srcSizeMm, targetSizeMm, opts);
    default:
      // Default = mirror (es el mas seguro para fotos reales).
      return extendMirror(dataUrl, srcSizeMm, targetSizeMm);
  }
}
