// buildDobbleJob.js — POSA un mazo Dobble (receta `recta-dobble-deck`) sobre una
// PLANTILLA de PrintLayout ya elegida por el usuario. Análogo a buildOrderJob:
// función de orquestación del RENDERER (usa canvas) que devuelve
// { template, images, assignmentsFront, assignmentsBack, minPages } listo para
// openInTab. NO toca red ni estado de React, NO arma grilla ni cortes: la hoja,
// los márgenes, la separación, el diámetro de la celda y el corte circular los
// define la plantilla (controles normales de PrintLayout). Las cartas se
// regeneran al tamaño de esa celda y se reparten (multipágina si hace falta).
//
// Geometría derivada de la plantilla (celdas circulares homogéneas):
//   - lado de la celda  S = min(celda.w, celda.h)
//   - inset del corte    M = cutMarginMm (o derivado de los cortes)  = SANGRADO
//   - diámetro de carta  D = S − 2·M          (el corte = borde visible de la carta)
// Render a tamaño físico: por carta, SVG con sangrado (radio 1 = corte; el fondo
// se extiende hasta el borde de la celda) → rasterizado a PNG a `dpi`. El objeto
// imagen se fabrica a mano (sin readImageFile/normalizeImageToSrgb: no re-muestrear
// ni snap-blanco), con fitOverride:'cover' y physicalSizeMm = la celda.

import { renderCartaSVG, renderDorsoSVG, bleedNormal } from './vendor/render.js';
import { estiloDeReceta } from './vendor/receta.js';
import {
  bleedMmForCell,
  fixedPageCount,
  cellsForPage,
  pageStartOffset,
} from '../lib/templates.js';

const MM_PER_IN = 25.4;

export const DOBBLE_DEFAULTS = {
  dpi: 300,
};

let _imgSeq = 0;
function nuevoId() {
  _imgSeq += 1;
  return `img_${Date.now().toString(36)}_${_imgSeq.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// Fabrica el objeto-imagen que espera el layout, SIN pasar por el pipeline de
// carga (que re-muestrea y hace snap a blanco). La imagen ya está a tamaño físico.
// wMM/hMM = tamaño físico de la celda (hMM = wMM si es cuadrada).
function imagenAMano(name, dataUrl, pxW, pxH, wMM, hMM = wMM) {
  return {
    id: nuevoId(),
    name,
    dataUrl,
    width: pxW,
    height: pxH,
    mime: 'image/png',
    faces: [],
    physicalSizeMm: { w: wMM, h: hMM },
    physicalSizeMmTrusted: true,
    fitOverride: 'cover',
  };
}

// Rol EXPLÍCITO de la celda (data-driven, NUNCA por tamaño): 'card' (default) |
// 'caja' | 'frente-caja'. Las instrucciones/portada + QR van horneadas en el
// fondo del Corel (no son celdas), así que no hay rol 'fija' ni ambigüedad.
export function cellRole(cell) {
  return cell?.role || 'card';
}

// PNG chico de color sólido, para pintar una celda entera de ese color (cover).
// Lo usa el "fondo de caja" en modo color.
function solidColorImage(hex, px = 8) {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = hex || '#ffffff';
  ctx.fillRect(0, 0, px, px);
  return canvas.toDataURL('image/png');
}

// Dimensiones px de un dataUrl (para que el cover-crop del export recorte bien).
function medirImagen(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || img.width || 1, h: img.naturalHeight || img.height || 1 });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = dataUrl;
  });
}

// Primera celda de carta (rol 'card') de la plantilla, mirando `celdas` o `pages[]`.
function firstCardCell(template) {
  const scan = (cells) => (cells || []).find((c) => cellRole(c) === 'card') || (cells || [])[0] || null;
  const fromCeldas = scan(template?.celdas);
  if (fromCeldas) return fromCeldas;
  if (Array.isArray(template?.pages)) {
    for (const pg of template.pages) {
      const c = scan(pg?.celdas);
      if (c) return c;
    }
  }
  return null;
}

// Rasteriza un string SVG a PNG dataUrl de pxW×pxH. El SVG dibuja la carta como
// CÍRCULO (radio 1+sangrado); para que la celda CUADRADA quede pintada hasta el
// borde (esquinas incluidas) pintamos primero el `bgColor` (el fondo de la carta)
// y encima el SVG. Así, aunque el plotter se desfase, el corte siempre cae sobre
// tinta. Los <image href="data:..."> no tiñen el canvas (data: = same-origin) →
// toDataURL funciona.
function rasterizarSVG(svgString, pxW, pxH, bgColor) {
  return new Promise((resolve, reject) => {
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = pxW;
        canvas.height = pxH;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (bgColor) {
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, pxW, pxH);
        }
        ctx.drawImage(img, 0, 0, pxW, pxH);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('No se pudo rasterizar el SVG de la carta.'));
    img.src = src;
  });
}

// Inset del corte (mm) de una celda: cutMarginMm de la plantilla si está, sino se
// deriva del corte real (mínimo de los 4 lados), sino 0. Es el SANGRADO de la carta.
function cutInsetMm(template, cell) {
  const m = Number(template?.cutMarginMm);
  if (Number.isFinite(m) && m >= 0) return m;
  const b = bleedMmForCell(template, cell);
  if (b) {
    const min = Math.min(b.top, b.right, b.bottom, b.left);
    if (Number.isFinite(min) && min >= 0) return min;
  }
  return 0;
}

/**
 * Geometría Dobble derivada de una plantilla. La usa el modal de posado para
 * mostrar el ⌀ de carta / sangrado / cartas por hoja antes de posar.
 * @returns {{ ok:boolean, reason?:string, side?:number, cutMargin?:number,
 *   diam?:number, bleed?:number, cellsPerPage?:number, circular?:boolean }}
 */
export function dobbleGeometryFromTemplate(template) {
  const c0 = firstCardCell(template);
  if (!c0) return { ok: false, reason: 'La plantilla no tiene celdas de carta.' };
  const side = Math.min(c0.w, c0.h);
  if (!(side > 0)) return { ok: false, reason: 'La celda de la plantilla no tiene tamaño válido.' };
  const cutMargin = cutInsetMm(template, c0);
  const diam = side - 2 * cutMargin;
  if (!(diam > 0)) {
    return { ok: false, reason: `El margen de corte (${cutMargin} mm) deja la carta en 0.` };
  }
  return {
    ok: true,
    side: Math.round(side * 10) / 10,
    cutMargin: Math.round(cutMargin * 100) / 100,
    diam: Math.round(diam * 10) / 10,
    bleed: Math.round(cutMargin * 100) / 100,
    cellsPerPage: template?.celdas?.length ?? 0, // solo aplica a plantilla de 1 hoja
    circular: (template?.cutShape ?? 'rect') === 'circle',
  };
}

// Capacidad de posado de una plantilla (para el modal): cuántas celdas 'card'
// tiene y si es multi-hoja (combo). Para single-page, cardCells = celdas 'card';
// para combo, suma las celdas 'card' de todas las páginas.
export function dobbleCardCapacity(template) {
  if (fixedPageCount(template) !== null) {
    let cardCells = 0;
    for (const pg of (template.pages || [])) {
      for (const c of (pg.celdas || [])) if (cellRole(c) === 'card') cardCells++;
    }
    return { cardCells, multi: true, pages: template.pages.length };
  }
  const cardCells = (template.celdas || []).filter((c) => cellRole(c) === 'card').length;
  return { cardCells, multi: false, pages: 1 };
}

// Arma un COMBO "Mazo Dobble" de 3 hojas a partir de 2 plantillas guardadas:
//   A = hoja de cartas (se usa ×2 → hojas 1 y 2), B = hoja cartas+caja (→ hoja 3).
// El resultado es una plantilla multi-hoja `pages=[A,A,B]`, cada página con su
// propio `pdfBase64` (+`bgKey`) para que el export embeba el fondo A en 1-2 y el
// B en 3. Los roles se marcan por tamaño RELATIVO al de la carta de A (que es,
// por definición, la hoja de cartas): las celdas del tamaño de la carta → 'card';
// las de otro tamaño (la caja) → 'caja' (en blanco en el MVP). Es dato explícito
// horneado en `cell.role`, no una heurística en tiempo de posado.
export function buildComboTemplate(A, B, { name, categoria } = {}) {
  if (!A || !B) return { error: 'Faltan las dos plantillas (A = cartas, B = cartas+caja).' };
  const cardRef = firstCardCell(A);
  if (!cardRef) return { error: 'La plantilla A (hoja de cartas) no tiene celdas de carta.' };
  if (Math.round(A.pageWidthMm) !== Math.round(B.pageWidthMm)
      || Math.round(A.pageHeightMm) !== Math.round(B.pageHeightMm)) {
    return { error: 'Las plantillas A y B tienen distinto tamaño de hoja.' };
  }
  const cw = cardRef.w, ch = cardRef.h;
  const tag = (cells) => (cells || []).map((c) => ({
    ...c,
    role: (Math.abs(c.w - cw) <= 2 && Math.abs(c.h - ch) <= 2) ? 'card' : (c.role || 'caja'),
  }));
  const pageOf = (t, bgKey) => ({
    celdas: tag(t.celdas),
    celdasDorso: t.celdasDorso || [],
    pdfBase64: t.pdfBase64 || null,
    bgKey,
  });
  const template = {
    name: name || 'Mazo Dobble (3 hojas)',
    ...(categoria ? { categoria } : {}),
    pageWidthMm: A.pageWidthMm,
    pageHeightMm: A.pageHeightMm,
    pageCount: 3,
    pages: [pageOf(A, 'A'), pageOf(A, 'A'), pageOf(B, 'B')],
    doubleSided: true,
    comboDobble: { aName: A.name, bName: B.name },
  };
  return { template };
}

// Estilo de render de la carta: el de la receta + override de fondo (color) y la
// imagen de fondo opcional, ambos definidos en PrintLayout (viajan en la plantilla).
// Precedencia: el override MANUAL de PrintLayout (fondoColor/fondoImagen) gana; si
// no se setea, cae al fondo que trae la RECETA (carta.fondo / carta.fondoImagen,
// ya expuesto por estiloDeReceta tras re-vendorizar); último recurso, blanco/sin
// imagen. El dorso no lleva imagen de fondo hoy → no se toca acá.
export function estiloConFondo(carta, fondoColor, fondoImagen) {
  const base = estiloDeReceta(carta);
  return {
    ...base,
    fondo: fondoColor || base.fondo || carta?.fondo || '#ffffff',
    fondoImagen: fondoImagen || base.fondoImagen || carta?.fondoImagen || null,
  };
}

/**
 * Posa un mazo Dobble (receta con dataUrls resueltos) sobre una plantilla.
 * @param {object} receta   receta `recta-dobble-deck` v1 (modo inline / assets resueltos).
 * @param {object} opts
 * @param {object} opts.template     plantilla de PrintLayout elegida (celdas + cortes + hoja).
 * @param {string} [opts.fondo]      color de fondo de la carta (override de receta.carta.fondo).
 * @param {string} [opts.fondoImagen] dataUrl de imagen de fondo de la carta.
 * @param {boolean} [opts.dobleFaz]  override doble faz (default = template.doubleSided).
 * @param {number}  [opts.dpi]       dpi del raster (default 300).
 * @returns {Promise<{spec:object|null, error?:string}>}
 */
export async function buildDobbleJob(receta, opts = {}) {
  const template = opts.template;
  if (!template) return { spec: null, error: 'Falta la plantilla para posar el mazo.' };

  // Plantilla multi-hoja (combo Dobble de 3 hojas): reparto por rol de celda a lo
  // largo de las páginas. NO genera cortes ni QR (los pone el plotter por QR).
  if (fixedPageCount(template) !== null) {
    return buildDobbleComboSpec(receta, opts);
  }

  const geo = dobbleGeometryFromTemplate(template);
  if (!geo.ok) return { spec: null, error: geo.error || geo.reason || 'Plantilla no apta para Dobble.' };

  const carta = receta.carta || {};
  const dpi = Number(opts.dpi ?? DOBBLE_DEFAULTS.dpi) || 300;
  const side = geo.side;          // tamaño de la celda (mm) = tamaño del PNG
  const diam = geo.diam;          // ⌀ de carta (corte)
  const bleed = geo.bleed;        // sangrado (= inset del corte)
  const cellsPorHoja = geo.cellsPerPage;
  const doubleSided = opts.dobleFaz != null ? !!opts.dobleFaz : !!template.doubleSided;

  const fondoColor = opts.fondo || carta.fondo || '#ffffff';
  const fondoImagen = opts.fondoImagen || null;
  const bleedNorm = bleedNormal(diam, bleed);
  const pxCell = Math.max(1, Math.round((side / MM_PER_IN) * dpi));

  // 1) Render a tamaño físico de cada carta (con sangrado) → PNG.
  const estilo = estiloConFondo(carta, fondoColor, fondoImagen);
  const images = [];
  const frontIds = [];
  for (let i = 0; i < receta.cartas.length; i++) {
    const svg = renderCartaSVG({
      placements: receta.cartas[i].placements,
      simbolos: receta.simbolos,
      estilo,
      bleedNorm,
      idPrefijo: `d${i}`,
    });
    const dataUrl = await rasterizarSVG(svg, pxCell, pxCell, fondoColor);
    const im = imagenAMano(`Carta ${i + 1}`, dataUrl, pxCell, pxCell, side);
    images.push(im);
    frontIds.push(im.id);
  }

  // 2) assignmentsFront: cada carta una vez, paginado por cellsPorHoja.
  const assignmentsFront = frontIds.slice();
  while (assignmentsFront.length % cellsPorHoja !== 0) assignmentsFront.push(null);
  const minPages = Math.max(1, Math.ceil(assignmentsFront.length / cellsPorHoja));

  // 3) Doble faz: un único dorso compartido en TODAS las celdas (la plantilla
  //    deriva las celdas del dorso espejando el frente). El arte del dorso pinta
  //    el fondo más allá del corte (sangrado) igual que el frente.
  //    FIX: el color de relleno de las esquinas (pre-pintado del canvas) usa el
  //    fondo EFECTIVO del dorso (con default), nunca undefined → no quedan
  //    esquinas transparentes en el reverso.
  let assignmentsBack = [];
  if (doubleSided) {
    const dorsoFondo = receta.dorso?.fondo ?? '#2f6df6'; // = default de renderDorsoSVG
    // El spread conserva dorso.fondoImagen (solo pisamos el color de fondo): el
    // motor 0.5.0 dibuja esa imagen en el dorso, recortada a la forma + sangrado.
    const dorso = { ...(receta.dorso || {}), fondo: dorsoFondo };
    const dorsoSvg = renderDorsoSVG(dorso, estiloDeReceta(carta), { bleedNorm });
    const dorsoData = await rasterizarSVG(dorsoSvg, pxCell, pxCell, dorsoFondo);
    const dorsoImg = imagenAMano('Dorso', dorsoData, pxCell, pxCell, side);
    images.push(dorsoImg);
    assignmentsBack = assignmentsFront.map((id) => (id == null ? null : dorsoImg.id));
  }

  // 4) Plantilla de salida = la elegida + marca de mazo Dobble + fondo de carta.
  //    Conserva celdas / cortes / hoja / márgenes de la plantilla (NO se regeneran).
  const dobbleFondo = (fondoColor || fondoImagen)
    ? {
        ...(opts.fondo ? { color: opts.fondo } : {}),
        ...(fondoImagen ? { imagen: fondoImagen } : {}),
      }
    : (template.dobbleFondo || undefined);

  const templateOut = {
    ...template,
    doubleSided,
    dobbleFondo,
    dobble: {
      n: receta.mazo?.n ?? null,
      diametroMM: diam,        // ⌀ de carta (corte)
      cellDiamMm: side,        // ⌀ de celda (impreso, con sangrado)
      bleedMM: bleed,
      dpi,
      doubleSided,
      cellsPerPage: cellsPorHoja,
      cartas: receta.cartas.length,
    },
  };

  const nLbl = receta.mazo?.n ?? '?';
  return {
    spec: {
      name: `Dobble n${nLbl} · ${template.name || 'plantilla'}${doubleSided ? ' (doble faz)' : ''}`,
      template: templateOut,
      images,
      assignmentsFront,
      assignmentsBack,
      minPages,
    },
  };
}

/**
 * Posa un mazo sobre una plantilla MULTI-HOJA (combo Dobble de 3 hojas). Reparte
 * por ROL EXPLÍCITO de celda a lo largo de las páginas (`pages[]`). Solo 2 roles:
 *   - 'card'        → cartas Dobble (render redondo al tamaño de la celda)
 *   - 'caja'        → recuadro de la caja: color sólido (opts.caja.color) o, si no
 *                     hay 'frente-caja', la imagen (opts.caja.imagen, cover)
 *   - 'frente-caja' → (opcional) cuadrado del frente de la caja, con la imagen (cover)
 * Las instrucciones/portada y el QR van HORNEADOS en el fondo del PDF de Corel (no
 * son celdas). NO genera cortes ni QR (el plotter corta/hiende por QR). El export
 * usa el fondo per-hoja (`template.pages[p].pdfBase64`).
 * @param {object} receta
 * @param {object} opts  { template, fondo, fondoImagen (carta), caja:{color,imagen}, dpi }
 * @returns {Promise<{spec:object|null, error?:string, warning?:string}>}
 */
async function buildDobbleComboSpec(receta, opts = {}) {
  const template = opts.template;
  const pages = template.pages || [];
  if (pages.length === 0) return { spec: null, error: 'La plantilla multi-hoja no tiene páginas.' };

  const geo = dobbleGeometryFromTemplate(template);
  if (!geo.ok) return { spec: null, error: geo.reason || 'Plantilla no apta para Dobble.' };

  const carta = receta.carta || {};
  const dpi = Number(opts.dpi ?? DOBBLE_DEFAULTS.dpi) || 300;
  const side = geo.side;
  const diam = geo.diam;
  const bleed = geo.bleed;
  const bleedNorm = bleedNormal(diam, bleed);
  const pxCell = Math.max(1, Math.round((side / MM_PER_IN) * dpi));
  const fondoColor = opts.fondo || carta.fondo || '#ffffff';
  const fondoImagen = opts.fondoImagen || null;
  const estilo = estiloConFondo(carta, fondoColor, fondoImagen);

  // Orden PLANO de celdas — mismo criterio que exportPdf (cellsForPage + pageStartOffset).
  const flat = [];
  let totalCells = 0;
  for (let p = 0; p < pages.length; p++) {
    const cells = cellsForPage(template, p, 'front');
    const off = pageStartOffset(template, p, 'front');
    for (let i = 0; i < cells.length; i++) {
      flat.push({ cell: cells[i], role: cellRole(cells[i]), idx: off + i, page: p });
      totalCells = Math.max(totalCells, off + i + 1);
    }
  }

  const assignmentsFront = Array(totalCells).fill(null);
  const images = [];

  // 1) Cartas Dobble → celdas 'card' en orden (a lo largo de las 3 hojas).
  const cardCells = flat.filter((f) => f.role === 'card');
  const nCards = Math.min(receta.cartas.length, cardCells.length);
  for (let i = 0; i < nCards; i++) {
    const svg = renderCartaSVG({
      placements: receta.cartas[i].placements,
      simbolos: receta.simbolos,
      estilo,
      bleedNorm,
      idPrefijo: `d${i}`,
    });
    const dataUrl = await rasterizarSVG(svg, pxCell, pxCell, fondoColor);
    const cell = cardCells[i].cell;
    const im = imagenAMano(`Carta ${i + 1}`, dataUrl, pxCell, pxCell, cell.w, cell.h);
    images.push(im);
    assignmentsFront[cardCells[i].idx] = im.id;
  }
  const cartasSobrantes = receta.cartas.length - nCards;

  // 2) Caja (control "Fondo de caja"). SOLO 2 roles en la app: 'card' y 'caja'
  //    (+ 'frente-caja' opcional para el cuadrado del frente). Las cartas de
  //    instrucción / portada y el QR van HORNEADOS en el fondo del PDF de Corel
  //    (arte de fondo, sin celda) → el parser no las toma y no compiten en tamaño.
  //    - color  → pinta las celdas 'caja' (recuadro completo) con color sólido.
  //    - imagen → va en 'frente-caja' (cuadrado del frente) si existe; si no, en
  //               las 'caja' (cover). El corte/hendido lo hace el plotter (QR).
  const caja = opts.caja || template.cajaFondo || {};
  const cajaCells = flat.filter((x) => x.role === 'caja');
  const frenteCells = flat.filter((x) => x.role === 'frente-caja');
  const imgTargets = caja.imagen ? (frenteCells.length ? frenteCells : cajaCells) : [];
  const imgTargetIdx = new Set(imgTargets.map((f) => f.idx));
  if (caja.color) {
    const dataUrl = solidColorImage(caja.color);
    for (const f of cajaCells) {
      if (imgTargetIdx.has(f.idx)) continue; // la imagen cubre esta celda
      const im = imagenAMano('Caja (color)', dataUrl, 8, 8, f.cell.w, f.cell.h);
      images.push(im);
      assignmentsFront[f.idx] = im.id;
    }
  }
  if (caja.imagen) {
    const dims = await medirImagen(caja.imagen);
    for (const f of imgTargets) {
      const im = imagenAMano('Caja (frente)', caja.imagen, dims.w, dims.h, f.cell.w, f.cell.h);
      images.push(im);
      assignmentsFront[f.idx] = im.id;
    }
  }

  // 3) DOBLE FAZ: las cartas son doble faz siempre. Un único dorso compartido
  //    (renderDorsoSVG) para las celdas 'card' de las 3 hojas. Caja e
  //    instrucciones = solo frente (dorso en blanco → null). El export
  //    (buildDoubleSidedPdf) pone el fondo per-hoja en el frente y el dorso en blanco.
  const doubleSided = opts.dobleFaz != null ? !!opts.dobleFaz : (template.doubleSided !== false);
  let assignmentsBack = [];
  if (doubleSided) {
    const dorsoFondo = receta.dorso?.fondo ?? '#2f6df6'; // = default de renderDorsoSVG
    // El spread conserva dorso.fondoImagen (solo pisamos el color de fondo): el
    // motor 0.5.0 la dibuja en el dorso, recortada a la forma + sangrado.
    const dorso = { ...(receta.dorso || {}), fondo: dorsoFondo };
    const dorsoSvg = renderDorsoSVG(dorso, estiloDeReceta(carta), { bleedNorm });
    const dorsoData = await rasterizarSVG(dorsoSvg, pxCell, pxCell, dorsoFondo);
    const c0 = cardCells[0]?.cell || { w: side, h: side };
    const dorsoImg = imagenAMano('Dorso', dorsoData, pxCell, pxCell, c0.w, c0.h);
    images.push(dorsoImg);
    const roleByIdx = {};
    for (const f of flat) roleByIdx[f.idx] = f.role;
    // Solo las celdas 'card' con carta asignada llevan dorso; caja/frente = null.
    assignmentsBack = assignmentsFront.map((id, idx) => (id != null && roleByIdx[idx] === 'card' ? dorsoImg.id : null));
  }

  const dobbleFondo = (opts.fondo || fondoImagen)
    ? { ...(opts.fondo ? { color: opts.fondo } : {}), ...(fondoImagen ? { imagen: fondoImagen } : {}) }
    : (template.dobbleFondo || undefined);
  const cajaFondo = (caja.color || caja.imagen)
    ? { ...(caja.color ? { color: caja.color } : {}), ...(caja.imagen ? { imagen: caja.imagen } : {}) }
    : (template.cajaFondo || undefined);

  const templateOut = {
    ...template,
    doubleSided,
    dobbleFondo,
    cajaFondo,
    dobble: {
      n: receta.mazo?.n ?? null,
      diametroMM: diam,
      cellDiamMm: side,
      bleedMM: bleed,
      dpi,
      doubleSided,
      combo: true,
      pages: pages.length,
      cartas: receta.cartas.length,
      cardCells: cardCells.length,
      cajaCells: cajaCells.length,
    },
  };

  const nLbl = receta.mazo?.n ?? '?';
  const spec = {
    name: `Dobble n${nLbl} · ${template.name || 'combo'} (${pages.length} hojas${doubleSided ? ' · doble faz' : ''})`,
    template: templateOut,
    images,
    assignmentsFront,
    assignmentsBack,
    minPages: pages.length,
  };
  if (cartasSobrantes > 0) {
    return {
      spec,
      warning: `El mazo tiene ${receta.cartas.length} cartas pero la plantilla solo ${cardCells.length} celdas de carta; sobran ${cartasSobrantes}.`,
    };
  }
  return { spec };
}
