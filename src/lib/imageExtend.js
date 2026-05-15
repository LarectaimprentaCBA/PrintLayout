// Wrapper de compatibilidad. La logica real vive en imageBleed.js con varios
// metodos seleccionables. Esta funcion mantiene la firma antigua para los
// call sites que solo necesitan "extender al tamano X" sin elegir metodo
// (ej: App.jsx al pegar/cargar fotos con DPI conocido).
//
// Default: mirror — es el metodo mas robusto para fotos reales. Mejora respecto
// del edge-replicate-de-1-px anterior (que producia artefactos visibles).
import { extendMirror } from './imageBleed.js';

export function extendImageToSize(dataUrl, originalSizeMm, targetSizeMm) {
  return extendMirror(dataUrl, originalSizeMm, targetSizeMm);
}
