// receta.js (VENDOR) — lado CONSUMIDOR del formato `recta-dobble-deck`.
//
// Vendorizado de @larecta/dobble-engine (src/receta.js), recortado: PrintLayout
// solo CONSUME recetas (no las genera), asi que no traemos exportarReceta ni sus
// imports del generador (catalogo/generador/layout). Mantener en sync con el
// engine: si cambia el formato o el render, recopiar render.js + version.js y
// revisar estas funciones. Origen de verdad del render: ./render.js.

import { renderCartaSVG, bleedNormal } from './render.js';
import { VERSION } from './version.js';

export const RECETA_SCHEMA = 'recta-dobble-deck';
export const RECETA_VERSION = 1;
export { VERSION as ENGINE_VERSION };

/** Estilo de render (normalizado) derivado del bloque `carta` de la receta. */
export function estiloDeReceta(carta) {
  return {
    forma: carta.forma,
    fondo: carta.fondo,
    radioBorde: carta.radioBorde,
    borde: { color: carta.borde.color, grosor: carta.borde.grosorMM / (carta.diametroMM / 2) },
  };
}

/**
 * Re-renderiza una carta de la receta a SVG (string). Identico al preview del
 * engine si se usan los mismos `idPrefijo` y datos. `conSangrado` agrega el
 * bleed de la receta (extiende el fondo mas alla del corte sin mover el borde).
 */
export function renderCartaDeReceta(receta, indiceCarta, { idPrefijo = 'c', conSangrado = false } = {}) {
  const carta = receta.carta;
  const bleedNorm = conSangrado ? bleedNormal(carta.diametroMM, carta.bleedMM) : 0;
  return renderCartaSVG({
    placements: receta.cartas[indiceCarta].placements,
    simbolos: receta.simbolos,
    estilo: estiloDeReceta(carta),
    bleedNorm,
    idPrefijo,
  });
}

/**
 * Valida una receta `recta-dobble-deck`. Devuelve { ok, errores, avisos }.
 * - errores: bloquean la importacion (schema/version/forma incompatibles).
 * - avisos: no bloquean (ej. engineVersion distinta: el formato es compatible
 *   pero conviene recopiar el vendor si el render cambio).
 */
export function validarReceta(receta) {
  const errores = [];
  const avisos = [];
  if (!receta || typeof receta !== 'object') {
    return { ok: false, errores: ['El archivo no es un JSON de receta valido.'], avisos };
  }
  if (receta.schema !== RECETA_SCHEMA) {
    errores.push(`schema invalido: "${receta.schema}" (esperaba "${RECETA_SCHEMA}").`);
  }
  if (receta.version !== RECETA_VERSION) {
    errores.push(`version de receta ${receta.version} no soportada (esperaba ${RECETA_VERSION}).`);
  }
  if (receta.engineVersion !== VERSION) {
    avisos.push(
      `engineVersion de la receta (${receta.engineVersion}) != motor vendorizado (${VERSION}). ` +
        `El formato es compatible; si notas diferencias de dibujo, recopiar el vendor.`,
    );
  }
  const carta = receta.carta;
  if (!carta || !(carta.diametroMM > 0)) {
    errores.push('falta carta.diametroMM (> 0).');
  }
  if (carta && carta.forma && carta.forma !== 'circulo') {
    avisos.push(`forma "${carta.forma}": este modo arma corte CIRCULAR; el corte sera redondo igual.`);
  }
  if (!Array.isArray(receta.cartas) || receta.cartas.length === 0) {
    errores.push('la receta no tiene cartas.');
  }
  if (!Array.isArray(receta.simbolos) || receta.simbolos.length === 0) {
    errores.push('la receta no tiene simbolos.');
  }
  if (receta.modo && receta.modo !== 'inline' && receta.modo !== 'assets') {
    errores.push(`modo invalido "${receta.modo}" (inline | assets).`);
  }
  return { ok: errores.length === 0, errores, avisos };
}
