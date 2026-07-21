// Integración de Rótulos con el flujo NORMAL de trabajos/pestañas.
//
// La "receta" (spec) describe una plancha armada: qué plancha, qué modelo, la
// tipografía, colores, texto, líneas y ajustes de recuadro. A partir de la
// receta:
//   · buildRotulosTemplate → un template compatible con el editor (celdas +
//     cortes redondeados + QR fijo), con la receta embebida en template.rotulos.
//   · buildRotulosSheet → los 3 PNG compuestos (arte + nombre quemado) por
//     tamaño presente + el mapeo celda→PNG, para PINTAR la pestaña (WYSIWYG).
//   · buildRotulosPdfBytes → el PDF IMPRESO con el MOTOR PROBADO
//     (buildRotulosPlanchaPdf: raster 600dpi, marcas L, QR, corte fijo).
//
// Así la pantalla muestra los PNG y el impreso lo genera el motor de siempre.

import { planchaCeldas, MARK_MARGIN_MM } from './planchas.js';
import { cellsToRoundedRectCuts } from '../lib/grid.js';
import { resolveSizeLayout, zoneAsBox, effectivePad } from './textLayout.js';
import { makeCanvasMeasure, drawRotuloOverlay } from './drawOverlay.js';
import { cropImageDataUrl } from '../lib/imageCrop.js';
import { buildRotulosPlanchaPdf, centerCoverRect } from './exportRotulos.js';

const LINE_HEIGHT = 1.15;
const MIN_PT = 3;
const MAX_PT = 120;

// Cache de familias de fuente cargadas como FontFace (por fontId) para no
// re-registrarlas en cada armado/impresión.
const fontFamilyCache = new Map();

async function ensureFamily(api, fontId) {
  if (!fontId || !api) return null;
  if (fontFamilyCache.has(fontId)) return fontFamilyCache.get(fontId);
  const r = await api.readFont(fontId);
  if (!r?.ok) return null;
  const fam = `PLRot_${fontId}`;
  try {
    const buf = await fetch(r.dataUrl).then((x) => x.arrayBuffer());
    const face = new FontFace(fam, buf);
    await face.load();
    document.fonts.add(face);
    fontFamilyCache.set(fontId, fam);
    return fam;
  } catch {
    return null;
  }
}

// Saneo mínimo de una caja {x,y,w,h,rotation} con NaN (datos viejos).
function sanitizeBox(box) {
  if (!box) return box;
  if ([box.x, box.y, box.w, box.h].every(Number.isFinite)) return box;
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  return { ...box, x: num(box.x, 0), y: num(box.y, 0), w: num(box.w, 2), h: num(box.h, 1) };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Tamaños que USA una plancha (en orden de aparición).
export function planchaUsedSizes(planchaId) {
  const seen = new Set(); const list = [];
  for (const c of planchaCeldas(planchaId).celdas) if (!seen.has(c.size)) { seen.add(c.size); list.push(c.size); }
  return list;
}

// Template compatible con el editor. celdas llevan `size` extra (buildPdf lo
// ignora); el corte redondeado y el QR salen de la MISMA fuente que el .plt.
export function buildRotulosTemplate(planchaId, spec) {
  const p = planchaCeldas(planchaId);
  const celdas = p.celdas.map((c, i) => ({ id: `r${i}`, x: c.x, y: c.y, w: c.w, h: c.h, size: c.size }));
  const cortes = cellsToRoundedRectCuts(p.celdas);
  return {
    name: spec.name,
    pageWidthMm: p.pageWidthMm,
    pageHeightMm: p.pageHeightMm,
    pageCount: 1,
    singlePage: true, // sin fondo PDF: las celdas son guías, el impreso lo hace el motor
    celdas,
    cortes,
    markMarginMm: MARK_MARGIN_MM,
    cutId: p.qrId, // = texto del QR = nombre del .plt fijo
    conQr: true,
    cellWhiteBorderMm: 0, // que el render normal no dibuje marco extra
    cellBorderLineMm: 0,
    rotulos: { ...spec, planchaId }, // la receta completa para re-editar/imprimir
  };
}

// Carga modelo + arte + fuente para una receta. Devuelve, por tamaño presente,
// el arte (dataUrl) + su textBox EFECTIVO (override de la plancha o el del
// modelo). Lo usan tanto los PNG de pantalla como el PDF impreso.
export async function loadRotulosInputs(spec) {
  const api = typeof window !== 'undefined' ? window.printlayout?.rotulos : null;
  if (!api) throw new Error('API de rótulos no disponible.');
  const models = await api.modelsList();
  const model = (Array.isArray(models) ? models : []).find((m) => m.id === spec.modeloId);
  if (!model) throw new Error('El modelo de rótulos ya no existe.');

  const usedSizes = planchaUsedSizes(spec.planchaId);
  const drawBox = !model.arteIncluyeRecuadro && !spec.noBox;
  const family = await ensureFamily(api, spec.fontId);

  const sizesInput = {};
  for (const size of usedSizes) {
    const s = model.sizes?.[size];
    if (!s?.artePath || !s?.textBox) continue; // tamaño que el modelo no tiene
    let arteDataUrl = null;
    try { const r = await api.readImage({ modelId: model.id, arteFile: s.arteFile }); if (r?.ok) arteDataUrl = r.dataUrl; } catch { /* noop */ }
    const textBox = sanitizeBox(spec.boxOverrides?.[size] || s.textBox);
    sizesInput[size] = { arteDataUrl, wPx: s.wPx, hPx: s.hPx, cutMm: s.cutMm, textBox };
  }
  return { model, family, usedSizes, drawBox, sizesInput, arteIncluyeRecuadro: !!model.arteIncluyeRecuadro };
}

// Resuelve líneas + tamaño de fuente para un tamaño (igual que el preview 2C).
function layoutFor(spec, size, textBox, drawBox, measurePt) {
  const outlineMm = (spec.outline?.enabled && spec.outline.widthMm > 0) ? spec.outline.widthMm : 0;
  const pad = effectivePad(drawBox ? (spec.boxPadMm ?? 0.8) : 0, outlineMm, textBox);
  return resolveSizeLayout({
    text: spec.text,
    mode: spec.lineModes?.[size] || 'auto',
    boxWmm: Math.max(1, textBox.w - 2 * pad),
    boxHmm: Math.max(1, textBox.h - 2 * pad),
    minPt: MIN_PT, maxPt: MAX_PT, lineHeightFactor: LINE_HEIGHT, measurePt,
  });
}

// PNG compuesto de UN tamaño: arte (cover-crop al corte) + nombre quemado. Se
// dibuja con el MISMO motor de canvas que el preview y el PDF (drawRotuloOverlay).
async function composeSizePng(si, spec, family, drawBox, measurePt, dpi = 300) {
  const { cutMm, arteDataUrl, wPx, hPx, textBox } = si;
  const scale = dpi / 25.4;
  const W = Math.max(1, Math.round(cutMm.w * scale));
  const H = Math.max(1, Math.round(cutMm.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  if (arteDataUrl && wPx && hPx) {
    const rect = centerCoverRect(wPx, hPx, cutMm.w, cutMm.h);
    const cropped = await cropImageDataUrl(arteDataUrl, rect, wPx, hPx);
    try { const img = await loadImage(cropped); ctx.drawImage(img, 0, 0, W, H); } catch { /* noop */ }
  }

  const hasText = String(spec.text ?? '').trim().length > 0;
  if (hasText && family && textBox) {
    const layout = layoutFor(spec, si.size, textBox, drawBox, measurePt);
    drawRotuloOverlay(ctx, {
      scale, family, textColor: spec.color, boxColor: spec.boxColor,
      drawBox, box: drawBox ? zoneAsBox(textBox) : null, zone: textBox, layout,
      outline: spec.outline, lineHeightFactor: LINE_HEIGHT,
    });
  }
  return { dataUrl: canvas.toDataURL('image/png'), width: W, height: H };
}

// Arma la "hoja" para la pestaña: template + 3 PNG (uno por tamaño presente) +
// el mapeo celda→PNG (assignmentsFront, largo = total de celdas).
export async function buildRotulosSheet(spec) {
  const inputs = await loadRotulosInputs(spec);
  const template = buildRotulosTemplate(spec.planchaId, spec);
  const measurePt = inputs.family ? makeCanvasMeasure(inputs.family) : null;

  const images = [];
  const idBySize = {};
  for (const size of inputs.usedSizes) {
    const si = inputs.sizesInput[size];
    if (!si) continue;
    const png = await composeSizePng({ ...si, size }, spec, inputs.family, inputs.drawBox, measurePt);
    const id = `rot_${size}`;
    idBySize[size] = id;
    images.push({
      id, name: `Rótulo ${size}`, dataUrl: png.dataUrl, width: png.width, height: png.height,
      mime: 'image/png', faces: [],
      physicalSizeMm: { w: si.cutMm.w, h: si.cutMm.h }, physicalSizeMmTrusted: true,
      fitOverride: 'cover',
    });
  }
  const assignmentsFront = template.celdas.map((c) => idBySize[c.size] ?? null);
  return { template, images, assignmentsFront };
}

// PDF IMPRESO con el motor probado. `qr` es opcional: si no se pasa, lo arma con
// la config del server QR + el qrId de la plancha.
export async function buildRotulosPdfBytes(spec, { qr } = {}) {
  const inputs = await loadRotulosInputs(spec);
  const sizes = {};
  for (const size of inputs.usedSizes) {
    const si = inputs.sizesInput[size];
    if (!si) continue;
    sizes[size] = { dataUrl: si.arteDataUrl, wPx: si.wPx, hPx: si.hPx, textBox: si.textBox, cutMm: si.cutMm };
  }

  let qrPayload = qr;
  if (qrPayload === undefined) {
    const plancha = planchaCeldas(spec.planchaId);
    let cfg = null;
    try { cfg = await window.printlayout?.qrcut?.getConfig?.(); } catch { cfg = null; }
    qrPayload = (cfg && plancha.qrId)
      ? { text: plancha.qrId, sizeMm: cfg.qrSizeMm, bottomMm: cfg.qrBottomMm, centered: cfg.qrCentered }
      : null;
  }

  return buildRotulosPlanchaPdf({
    model: { sizes, arteIncluyeRecuadro: inputs.arteIncluyeRecuadro },
    family: inputs.family,
    color: spec.color, boxColor: spec.boxColor, noBox: spec.noBox, boxPadMm: spec.boxPadMm,
    text: spec.text, lineModes: spec.lineModes, outline: spec.outline,
    planchaId: spec.planchaId, markMarginMm: MARK_MARGIN_MM, qr: qrPayload,
  });
}
