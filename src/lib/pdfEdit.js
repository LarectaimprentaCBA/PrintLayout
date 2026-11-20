// Editar un PDF: sacar páginas, cambiarles el orden y sumar páginas de otros PDF.
//
// Las páginas se COPIAN tal cual (pdf-lib): no se convierten a imagen, así que
// el texto, los vectores y los colores quedan idénticos al original.
import { PDFDocument } from 'pdf-lib';

/**
 * Arma el PDF nuevo.
 * @param {Map<string, Uint8Array>|Object<string, Uint8Array>} sources - bytes de
 *   cada PDF de origen, por id.
 * @param {Array<{docId:string, pageIndex:number}>} pages - las páginas que
 *   quedan, EN ORDEN. pageIndex es 0-based dentro de su PDF de origen.
 * @returns {Promise<Uint8Array>}
 */
export async function buildEditedPdf(sources, pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('El PDF tiene que quedar con al menos una página.');
  }
  const bytesDe = (id) => (sources instanceof Map ? sources.get(id) : sources?.[id]);
  const out = await PDFDocument.create();
  const abiertos = new Map(); // docId → PDFDocument (se abre una sola vez)

  // Tramos seguidos del mismo PDF se copian juntos (más rápido y comparten
  // fuentes/imágenes en vez de duplicarlas por página).
  let i = 0;
  while (i < pages.length) {
    const docId = pages[i].docId;
    const indices = [];
    while (i < pages.length && pages[i].docId === docId) { indices.push(pages[i].pageIndex); i++; }
    let src = abiertos.get(docId);
    if (!src) {
      const bytes = bytesDe(docId);
      if (!bytes) throw new Error('Falta uno de los PDF de origen.');
      src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      abiertos.set(docId, src);
    }
    const total = src.getPageCount();
    for (const n of indices) {
      if (!(Number.isInteger(n) && n >= 0 && n < total)) throw new Error(`La página ${n + 1} no existe en el PDF de origen.`);
    }
    const copiadas = await out.copyPages(src, indices);
    for (const p of copiadas) out.addPage(p);
  }
  out.setProducer('PrintLayout');
  return out.save();
}

// ── Operaciones sobre la lista de páginas (puras; la ventana solo las llama) ──

/** Saca las páginas cuyas claves están en `keys`. */
export function removePages(pages, keys) {
  const s = keys instanceof Set ? keys : new Set(keys);
  return pages.filter((p) => !s.has(p.key));
}

/**
 * Mete `nuevas` después de la página `afterKey` (null/desconocida = al final).
 */
export function insertPagesAfter(pages, nuevas, afterKey) {
  const idx = afterKey == null ? -1 : pages.findIndex((p) => p.key === afterKey);
  if (idx < 0) return [...pages, ...nuevas];
  return [...pages.slice(0, idx + 1), ...nuevas, ...pages.slice(idx + 1)];
}

/**
 * Mueve las páginas `keys` (conservando su orden entre sí) para que queden justo
 * ANTES de la página `beforeKey` (null = al final).
 */
export function movePagesBefore(pages, keys, beforeKey) {
  const s = keys instanceof Set ? keys : new Set(keys);
  if (s.size === 0 || s.has(beforeKey)) return pages;
  const movidas = pages.filter((p) => s.has(p.key));
  const resto = pages.filter((p) => !s.has(p.key));
  const idx = beforeKey == null ? -1 : resto.findIndex((p) => p.key === beforeKey);
  if (idx < 0) return [...resto, ...movidas];
  return [...resto.slice(0, idx), ...movidas, ...resto.slice(idx)];
}

/** Corre las páginas `keys` un lugar hacia la izquierda (-1) o la derecha (+1). */
export function shiftPages(pages, keys, dir) {
  const s = keys instanceof Set ? keys : new Set(keys);
  const out = pages.slice();
  if (dir < 0) {
    for (let i = 1; i < out.length; i++) {
      if (s.has(out[i].key) && !s.has(out[i - 1].key)) { const t = out[i - 1]; out[i - 1] = out[i]; out[i] = t; }
    }
  } else {
    for (let i = out.length - 2; i >= 0; i--) {
      if (s.has(out[i].key) && !s.has(out[i + 1].key)) { const t = out[i + 1]; out[i + 1] = out[i]; out[i] = t; }
    }
  }
  return out;
}
