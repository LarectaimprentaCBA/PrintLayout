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
import { bleedMmForCell } from '../lib/templates.js';

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
function imagenAMano(name, dataUrl, pxW, pxH, cellMM) {
  return {
    id: nuevoId(),
    name,
    dataUrl,
    width: pxW,
    height: pxH,
    mime: 'image/png',
    faces: [],
    physicalSizeMm: { w: cellMM, h: cellMM },
    physicalSizeMmTrusted: true,
    fitOverride: 'cover',
  };
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
  const cells = template?.celdas ?? [];
  if (cells.length === 0) return { ok: false, reason: 'La plantilla no tiene celdas.' };
  const c0 = cells[0];
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
    cellsPerPage: cells.length,
    circular: (template.cutShape ?? 'rect') === 'circle',
  };
}

// Estilo de render de la carta: el de la receta + override de fondo (color) y la
// imagen de fondo opcional, ambos definidos en PrintLayout (viajan en la plantilla).
function estiloConFondo(carta, fondoColor, fondoImagen) {
  const base = estiloDeReceta(carta);
  return {
    ...base,
    fondo: fondoColor || base.fondo || '#ffffff',
    fondoImagen: fondoImagen || null,
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
