// Armador de jobs para un pedido de fotos de la web (renderer).
//
// Dado un pedido ya descargado (con las fotos en disco temporal), arma UN job
// por cada tamaño pedido, reusando el pipeline existente:
//   - readAnyFileToImage (HEIC→JPEG, normalización sRGB, detección de caras)
//   - computeGrid / generateCuts para tamaños custom
//   - plantilla estándar guardada para presets
// Devuelve specs listos para guardar (jobs.save) y abrir (openInTab). NO toca
// red ni estado de React: es una función pura de orquestación.

import { computeGrid, generateCuts, centerCellsInSheet } from '../lib/grid.js';
import { readAnyFileToImage } from '../lib/images.js';
import { resolvePresetTemplate } from './presets.js';
import { CUSTOM_SHEET } from './sheetCriteria.js';

function guessMime(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function cloneTemplate(tpl) {
  return JSON.parse(JSON.stringify(tpl));
}

// Construye una plantilla de grilla en memoria para un tamaño custom (wmm×hmm).
function buildCustomGridTemplate(wmm, hmm, label) {
  const s = CUSTOM_SHEET;
  const { cells } = computeGrid({
    paperW: s.paperWidthMm,
    paperH: s.paperHeightMm,
    cellW: wmm,
    cellH: hmm,
    marginX: s.marginXMm,
    marginY: s.marginYMm,
    spacingX: s.spacingXMm,
    spacingY: s.spacingYMm,
  });
  const cortes = s.markMarginMm > 0
    ? generateCuts(cells, { cutShape: s.cutShape, cutMarginMm: s.cutMarginMm })
    : [];
  return {
    name: `Fotos ${label || `${wmm}x${hmm}`}`,
    pdfBase64: null,
    pageWidthMm: s.paperWidthMm,
    pageHeightMm: s.paperHeightMm,
    pageCount: 1,
    celdas: cells,
    celdasDorso: [],
    cortes,
    cutMarginMm: s.cutMarginMm,
    markMarginMm: s.markMarginMm,
    cutShape: s.cutShape,
    doubleSided: false,
    singlePage: true,
  };
}

// order: { id, numero_presupuesto, items: [{ tamano, fotos: [{path, localPath, nombre, copias}] }] }
// deps: { templates, readFileBytes(localPath) -> Promise<Uint8Array|null> }
// → { specs: [{ name, sizeLabel, template, images, assignmentsFront, assignmentsBack, minPages }], skipped: [{label, reason}] }
export async function buildOrderJobs(order, { templates, readFileBytes }) {
  const num = order?.numero_presupuesto || order?.id;
  const items = Array.isArray(order?.items) ? order.items : [];
  const multi = items.length > 1;
  const specs = [];
  const skipped = [];

  for (const item of items) {
    const tamano = item?.tamano || {};
    const sizeLabel = tamano.label || (tamano.wmm && tamano.hmm ? `${tamano.wmm}x${tamano.hmm}` : 'tamaño');
    const fotos = Array.isArray(item?.fotos) ? item.fotos : [];
    if (fotos.length === 0) {
      skipped.push({ label: sizeLabel, reason: 'sin fotos' });
      continue;
    }

    // 1) Plantilla: preset guardado o grilla custom.
    let template;
    let isCustomGrid = false;
    if (tamano.tipo === 'preset') {
      const found = resolvePresetTemplate(templates, tamano.id);
      if (!found) {
        skipped.push({ label: sizeLabel, reason: `no hay plantilla para el preset "${tamano.id}" (Mariano debe crearla)` });
        continue;
      }
      template = cloneTemplate(found);
    } else if (tamano.tipo === 'custom') {
      isCustomGrid = true;
      const wmm = Number(tamano.wmm);
      const hmm = Number(tamano.hmm);
      if (!(wmm > 0 && hmm > 0)) {
        skipped.push({ label: sizeLabel, reason: 'tamaño custom sin medidas válidas' });
        continue;
      }
      template = buildCustomGridTemplate(wmm, hmm, tamano.label);
    } else {
      // Tipo desconocido o faltante: NO inventamos una hoja custom por defecto
      // (eso armaría medidas inventadas en silencio). Salteamos con un mensaje claro.
      skipped.push({
        label: sizeLabel,
        reason: tamano.tipo
          ? `tipo de tamaño desconocido: "${tamano.tipo}" (esperaba "preset" o "custom")`
          : 'el tamaño no indica tipo (preset/custom)',
      });
      continue;
    }

    const cellsPerPage = Array.isArray(template.celdas) ? template.celdas.length : 0;
    if (cellsPerPage === 0) {
      skipped.push({ label: sizeLabel, reason: 'la plantilla no tiene celdas (¿el tamaño entra en la hoja?)' });
      continue;
    }

    // 2) Cargar cada foto (1:1 con su entrada para respetar "copias").
    const loaded = []; // { image, copias }
    for (const foto of fotos) {
      const bytes = await readFileBytes(foto.localPath);
      if (!bytes) {
        skipped.push({ label: sizeLabel, reason: `no se pudo leer ${foto.nombre || foto.path}` });
        continue;
      }
      const file = new File([bytes], foto.nombre || 'foto.jpg', { type: guessMime(foto.nombre) });
      let image;
      try {
        image = await readAnyFileToImage(file);
      } catch (err) {
        skipped.push({ label: sizeLabel, reason: `error procesando ${foto.nombre}: ${err.message}` });
        continue;
      }
      // Encuadre por caras al imprimir (la celda se rellena recortando).
      image.fitOverride = 'cover';
      loaded.push({ image, copias: Math.max(1, Math.floor(Number(foto.copias) || 1)) });
    }
    if (loaded.length === 0) {
      skipped.push({ label: sizeLabel, reason: 'no se cargó ninguna foto' });
      continue;
    }

    // 3) Asignación: cada foto repetida por sus copias, paginando por celdas.
    const images = loaded.map((l) => l.image);
    const realAssignments = [];
    for (const { image, copias } of loaded) {
      for (let c = 0; c < copias; c++) realAssignments.push(image.id);
    }
    const totalDesigns = realAssignments.length;

    // Si los diseños entran en UNA sola hoja, los centramos: recortamos la grilla
    // a exactamente esa cantidad y la centramos (la fila final incompleta queda
    // centrada, no pegada arriba-izquierda). Solo para grilla custom — los
    // presets son layouts fijos de Mariano. Regeneramos los cortes para que el
    // plotter corte donde realmente quedaron las celdas.
    if (isCustomGrid && totalDesigns > 0 && totalDesigns <= cellsPerPage) {
      const s = CUSTOM_SHEET;
      const used = template.celdas.slice(0, totalDesigns).map((c) => ({ ...c }));
      centerCellsInSheet(used, {
        direction: 'rows',
        innerW: s.paperWidthMm - 2 * s.marginXMm,
        innerH: s.paperHeightMm - 2 * s.marginYMm,
        marginX: s.marginXMm,
        marginY: s.marginYMm,
      });
      template.celdas = used;
      template.cortes = s.markMarginMm > 0
        ? generateCuts(used, { cutShape: s.cutShape, cutMarginMm: s.cutMarginMm })
        : [];
    }

    const cpp = Array.isArray(template.celdas) ? template.celdas.length : cellsPerPage;
    const assignmentsFront = realAssignments.slice();
    while (assignmentsFront.length % cpp !== 0) assignmentsFront.push(null);
    const minPages = Math.max(1, Math.ceil(assignmentsFront.length / cpp));

    const name = multi ? `P-${num}-fotos ${sizeLabel}` : `P-${num}-fotos`;
    specs.push({
      name,
      sizeLabel,
      template,
      images,
      assignmentsFront,
      assignmentsBack: [],
      minPages,
    });
  }

  return { specs, skipped };
}
