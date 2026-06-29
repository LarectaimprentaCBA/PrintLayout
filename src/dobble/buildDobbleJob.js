// buildDobbleJob.js — arma un JOB de PrintLayout a partir de una RECETA
// `recta-dobble-deck` (Paso 2 de la unión Dobble↔PrintLayout). Análogo a
// src/intake/buildOrderJob.js: función de orquestación del RENDERER (usa canvas)
// que devuelve { template, images, assignmentsFront, assignmentsBack, minPages }
// listo para openInTab. NO toca red ni estado de React.
//
// Render a TAMAÑO FÍSICO con el renderer compartido (vendor): por carta, SVG con
// sangrado (el fondo se pinta hasta el borde de la celda = bleed REAL), rasterizado
// a PNG a `dpi`. La celda = diámetro + 2·bleed. El objeto-imagen se fabrica a mano
// (sin readImageFile/normalizeImageToSrgb: no re-muestrear ni hacer snap-blanco),
// con fitOverride:'cover' y physicalSizeMm.

import { computeBestGrid, centerCellsInSheet, generateCuts } from '../lib/grid.js';
import { renderCartaDeReceta, estiloDeReceta } from './vendor/receta.js';
import { renderDorsoSVG, bleedNormal } from './vendor/render.js';

const MM_PER_IN = 25.4;

// Defaults de imposición (la hoja y los márgenes los puede pasar el caller).
export const DOBBLE_DEFAULTS = {
  paperWidthMm: 210,   // A4
  paperHeightMm: 297,
  gapMM: 3,            // separación mínima entre cartas
  markMarginMm: 10,    // marcas L de registro (igual que grilla rápida)
  holguraMM: 2,        // el margen ≥ markMargin + holgura (las marcas no pisan cartas)
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

// Rasteriza un string SVG a PNG dataUrl de pxW×pxH. El SVG extiende el fondo como
// CÍRCULO de sangrado (radio 1+bleed); para que la celda quede pintada hasta el
// borde (bleed REAL en toda la celda, esquinas incluidas), pintamos primero el
// `bgColor` (el fondo de la carta) y encima el SVG. Así, aunque el plotter se
// desfase, el corte siempre cae sobre tinta. Los <image href="data:..."> no tiñen
// el canvas (data: = same-origin) → toDataURL funciona.
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

/**
 * Arma el job de un mazo Dobble a partir de la receta (con dataUrls ya resueltos).
 * @param {object} receta  receta `recta-dobble-deck` v1 (modo inline o con assets ya resueltos a dataUrl).
 * @param {object} [opts]
 * @param {number} [opts.diametroMM]  override del diámetro (modo editar). Default = receta.carta.diametroMM.
 * @param {boolean} [opts.dobleFaz]   override doble faz. Default = !!receta.dorso.
 * @param {number} [opts.paperWidthMm] / [opts.paperHeightMm] / [opts.gapMM] / [opts.markMarginMm] / [opts.holguraMM] / [opts.dpi]
 * @returns {Promise<{spec:object|null, error?:string}>}
 */
export async function buildDobbleJob(receta, opts = {}) {
  const o = { ...DOBBLE_DEFAULTS, ...opts };
  const carta = receta.carta || {};
  const diam = Number(opts.diametroMM ?? carta.diametroMM);
  const bleed = Number(carta.bleedMM ?? 3);
  const registroTol = Number(carta.registroToleranciaMM ?? 0.5);
  if (!(diam > 0)) return { spec: null, error: 'La receta no tiene un diámetro válido.' };

  const cellMM = diam + 2 * bleed;                 // celda cuadrada (incluye sangrado)
  const margin = o.markMarginMm + o.holguraMM;     // margen ≥ markMargin + holgura
  const doubleSided = opts.dobleFaz != null ? !!opts.dobleFaz : !!receta.dorso;

  // 1) Grilla circular: celdas cuadradas de lado cellMM, mejor encaje en la hoja.
  const grid = computeBestGrid(
    {
      paperW: o.paperWidthMm,
      paperH: o.paperHeightMm,
      cellW: cellMM,
      cellH: cellMM,
      marginX: margin,
      marginY: margin,
      spacingX: o.gapMM,
      spacingY: o.gapMM,
    },
    { rotateMode: 'direct' }, // celda cuadrada: rotar no cambia nada
  );
  const cellsPorHoja = grid.cells.length;
  if (cellsPorHoja === 0) {
    return {
      spec: null,
      error: `La carta de ${cellMM.toFixed(1)}mm (con sangrado) no entra en la hoja ${o.paperWidthMm}×${o.paperHeightMm}mm.`,
    };
  }

  // 2) Celdas (con id) centradas en la hoja.
  const cells = grid.cells.map((c, idx) => ({ id: idx, x: c.x, y: c.y, w: c.w, h: c.h }));
  centerCellsInSheet(cells, {
    direction: 'rows',
    innerW: o.paperWidthMm - 2 * margin,
    innerH: o.paperHeightMm - 2 * margin,
    marginX: margin,
    marginY: margin,
  });

  // 3) Cortes circulares.
  //    1 cara  → cutMarginMm = bleed  → el corte cae EXACTO en el diámetro.
  //    doble faz → cutMarginMm = bleed + registroTolerancia → muerde para adentro
  //                (absorbe el desfase frente/dorso).
  const cutMarginMm = doubleSided ? bleed + registroTol : bleed;
  const cortes = generateCuts(cells, { cutShape: 'circle', cutMarginMm });

  // 4) Render a tamaño físico de cada carta (con sangrado) → PNG.
  const pxCell = Math.max(1, Math.round((cellMM / MM_PER_IN) * o.dpi));
  const images = [];
  const frontIds = [];
  for (let i = 0; i < receta.cartas.length; i++) {
    const svg = renderCartaDeReceta(receta, i, { idPrefijo: `d${i}`, conSangrado: true });
    const dataUrl = await rasterizarSVG(svg, pxCell, pxCell, carta.fondo);
    const im = imagenAMano(`Carta ${i + 1}`, dataUrl, pxCell, pxCell, cellMM);
    images.push(im);
    frontIds.push(im.id);
  }

  // 5) assignmentsFront: cada carta una vez, paginado por cellsPorHoja.
  const assignmentsFront = frontIds.slice();
  while (assignmentsFront.length % cellsPorHoja !== 0) assignmentsFront.push(null);
  const minPages = Math.max(1, Math.ceil(assignmentsFront.length / cellsPorHoja));

  // 6) Doble faz: un único dorso compartido en TODAS las celdas (backMirror:'y').
  //    El arte del dorso pinta el fondo más allá del corte (bleed) igual que el frente.
  let assignmentsBack = [];
  if (doubleSided) {
    const dorsoSvg = renderDorsoSVG(receta.dorso || {}, estiloDeReceta(carta), {
      bleedNorm: bleedNormal(diam, bleed),
    });
    const dorsoData = await rasterizarSVG(dorsoSvg, pxCell, pxCell, receta.dorso?.fondo);
    const dorsoImg = imagenAMano('Dorso', dorsoData, pxCell, pxCell, cellMM);
    images.push(dorsoImg);
    assignmentsBack = assignmentsFront.map((id) => (id == null ? null : dorsoImg.id));
  }

  // 7) Plantilla temporal (vive en la pestaña; cortes ya generados).
  const template = {
    name: `Dobble n${receta.mazo?.n ?? '?'} · ${diam}mm${doubleSided ? ' (doble faz)' : ''}`,
    pdfBase64: null,
    pageWidthMm: o.paperWidthMm,
    pageHeightMm: o.paperHeightMm,
    pageCount: 1,
    celdas: cells,
    celdasDorso: [],
    cortes,
    cutMarginMm,
    markMarginMm: o.markMarginMm,
    cutShape: 'circle',
    doubleSided,
    backMirror: doubleSided ? 'y' : undefined,
    backRotate180: doubleSided ? false : undefined,
    singlePage: true,
    temporal: true,
    tabBacked: true,
    gridParams: {
      paperW: o.paperWidthMm,
      paperH: o.paperHeightMm,
      cellW: cellMM,
      cellH: cellMM,
      margin,
      spacingX: o.gapMM,
      spacingY: o.gapMM,
      cutMargin: cutMarginMm,
      markMargin: o.markMarginMm,
      cutShape: 'circle',
    },
    // Marca este template como un mazo Dobble + datos para re-render al editar
    // el diámetro (los placements son lossless: re-render === preview).
    dobble: {
      n: receta.mazo?.n ?? null,
      diametroMM: diam,
      bleedMM: bleed,
      registroToleranciaMM: registroTol,
      dpi: o.dpi,
      paperWidthMm: o.paperWidthMm,
      paperHeightMm: o.paperHeightMm,
      gapMM: o.gapMM,
      markMarginMm: o.markMarginMm,
      holguraMM: o.holguraMM,
      doubleSided,
    },
  };

  return {
    spec: {
      name: template.name,
      template,
      images,
      assignmentsFront,
      assignmentsBack,
      minPages,
    },
  };
}
