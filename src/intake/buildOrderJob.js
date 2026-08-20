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
import { rotateImageDataUrl90CW, rotateFaces90CW } from '../lib/imageRotate.js';
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

// Nombre seguro para el QR / .plt: solo [A-Za-z0-9_-] (igual criterio que el
// cutId manual). Los ids del catálogo web ya vienen así; esto es defensivo.
function sanitizeCutName(s) {
  return String(s || '').replace(/[^A-Za-z0-9_-]/g, '');
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

// order: { id, numero_presupuesto, items: [{ tamano, fotos: [{path, localPath, nombre, copias, encuadre?}] }] }
//   encuadre?: { fit: 'cover'|'contain', focalPoint?: {x,y} en 0..1, rotation?: 0|90|180|270 }
// deps: { templates, readFileBytes(localPath) -> Promise<Uint8Array|null> }
// → { specs: [{ name, sizeLabel, template, images, assignmentsFront, assignmentsBack, minPages }], skipped: [{label, reason}] }
export async function buildOrderJobs(order, { templates, readFileBytes }) {
  const num = order?.numero_presupuesto || order?.id;
  const items = Array.isArray(order?.items) ? order.items : [];
  const specs = [];
  const skipped = [];

  // Agrupar ítems por plantilla IDÉNTICA. Dos líneas del carrito del mismo
  // preset (o del mismo custom wmm×hmm) se resuelven como UN solo spec con
  // todas sus fotos juntas; si no, generarían dos jobs con el MISMO nombre y el
  // segundo pisaría el .pljob/.pdf del primero (fotos perdidas sin aviso).
  // Tamaños DISTINTOS siguen siendo specs separados, como hoy.
  const groupKeyForTamano = (t) => {
    if (t?.tipo === 'preset') return `preset:${t.id}`;
    if (t?.tipo === 'custom') return `custom:${Number(t.wmm)}x${Number(t.hmm)}`;
    return `otro:${t?.tipo || ''}`;
  };
  const groups = [];
  const groupByKey = new Map();
  for (const item of items) {
    const tamano = item?.tamano || {};
    const key = groupKeyForTamano(tamano);
    let g = groupByKey.get(key);
    if (!g) {
      g = { tamano, fotos: [] };
      groupByKey.set(key, g);
      groups.push(g);
    }
    const itemFotos = Array.isArray(item?.fotos) ? item.fotos : [];
    for (const f of itemFotos) g.fotos.push(f);
  }
  // "multi" (sufijo de tamaño en el nombre) depende ahora de la cantidad de
  // GRUPOS, no de ítems: un pedido con 2 líneas del mismo tamaño = 1 grupo = 1
  // archivo sin sufijo (igual que un pedido de un solo ítem).
  const multi = groups.length > 1;

  for (const group of groups) {
    const tamano = group.tamano || {};
    const sizeLabel = tamano.label || (tamano.wmm && tamano.hmm ? `${tamano.wmm}x${tamano.hmm}` : 'tamaño');
    const fotos = group.fotos;
    if (fotos.length === 0) {
      skipped.push({ label: sizeLabel, reason: 'sin fotos' });
      continue;
    }

    // 1) Plantilla: preset guardado o grilla custom.
    let template;
    let isCustomGrid = false;
    // Id de la plancha para el QR de corte. SOLO en presets (planchas FIJAS de
    // geometría constante → un único corte base <planchaId>.plt reusable). Las
    // grillas custom tienen geometría variable por pedido → sin QR automático.
    let planchaId = null;
    if (tamano.tipo === 'preset') {
      const found = resolvePresetTemplate(templates, tamano.id);
      if (!found) {
        skipped.push({ label: sizeLabel, reason: `no hay plantilla para el preset "${tamano.id}" (Mariano debe crearla)` });
        continue;
      }
      template = cloneTemplate(found);
      // QR = id del catálogo (clave_web), estable y compartido por todas las
      // hojas de esta plancha. Estampamos cutId + conQr en la plantilla del job
      // para que el QR salga tanto en el PDF automático como al imprimir desde
      // una pestaña (modo "abrir"). Las planchas ya dejan lugar → sin reserva.
      planchaId = sanitizeCutName(found.catalogoId || tamano.id) || null;
      if (planchaId) {
        template.cutId = planchaId;
        template.conQr = true;
      }
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
      // Encuadre del cliente (viene de la web). La foto base ya está derecha por
      // EXIF; esto aplica la rotación/fit/foco que eligió en el editor. Orden:
      // primero rotar, después fit y foco (el focalPoint 0..1 se interpreta sobre
      // la orientación que vio el cliente). Sin encuadre (pedidos viejos o foto no
      // tocada) → cover, sin rotación, foco automático = comportamiento de hoy.
      const enc = foto.encuadre || {};
      // a) Rotación deliberada (múltiplos de 90). Remapea las caras en cada giro
      //    ANTES de pisar width/height (rotateFaces90CW necesita las dims viejas).
      let turns = Math.round((Number(enc.rotation) || 0) / 90) % 4;
      if (turns < 0) turns += 4;
      for (let t = 0; t < turns; t++) {
        image.faces = rotateFaces90CW(image.faces, image.width, image.height);
        const r = await rotateImageDataUrl90CW(image.dataUrl);
        image.dataUrl = r.dataUrl;
        image.width = r.width;
        image.height = r.height;
      }
      // b) Rellenar (cover, recorta) o entrar entera (contain).
      image.fitOverride = enc.fit === 'contain' ? 'contain' : 'cover';
      // c) Punto focal manual (0..1) para "mover"; si no viene, foco automático.
      //    Clamp defensivo [0,1] (la web valida, pero acá leemos de Supabase).
      const fp = enc.focalPoint;
      image.focalPoint = (fp && Number.isFinite(fp.x) && Number.isFinite(fp.y))
        ? { x: Math.min(1, Math.max(0, fp.x)), y: Math.min(1, Math.max(0, fp.y)) }
        : null;
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
      // Id de plancha para el corte por QR (null en grillas custom).
      planchaId,
    });
  }

  return { specs, skipped };
}
