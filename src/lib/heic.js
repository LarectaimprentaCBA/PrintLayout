import { heicTo } from 'heic-to';

// Los iPhone exportan fotos en .heic/.heif (codec HEVC). Chromium no los
// decodifica de forma nativa, asi que createImageBitmap y los <img> fallan.
// heic2any trae su propio decodificador (libheif compilado a WASM) y funciona
// sin internet, lo cual importa en la PC del taller.

export function isHeicFile(file) {
  if (!file) return false;
  const type = (file.type || '').toLowerCase();
  if (type === 'image/heic' || type === 'image/heif'
      || type === 'image/heic-sequence' || type === 'image/heif-sequence') {
    return true;
  }
  // Los HEIC suelen llegar con type vacio en Windows, asi que tambien miramos
  // la extension del nombre.
  return /\.(heic|heif)$/i.test(file.name || '');
}

// Convierte un File HEIC/HEIF a un File JPEG equivalente, conservando el nombre
// (cambiando la extension a .jpg). Si el archivo no es HEIC, lo devuelve igual.
async function convertOne(file) {
  if (!isHeicFile(file)) return file;
  const out = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
  const newName = (file.name || 'foto').replace(/(\.(heic|heif))+$/i, '') + '.jpg';
  return new File([out], newName, { type: 'image/jpeg', lastModified: file.lastModified });
}

// Prepara una lista de archivos entrantes (de un input o drag&drop) convirtiendo
// los HEIC/HEIF a JPEG. Devuelve File[] listos para el resto del pipeline.
// `onHeicProgress` (opcional) se llama una vez si hay al menos un HEIC, util
// para mostrar un aviso de "convirtiendo...".
export async function prepareIncomingImageFiles(fileList, { onHeicStart, onSkip } = {}) {
  const arr = Array.from(fileList || []);
  const hasHeic = arr.some(isHeicFile);
  if (hasHeic) onHeicStart?.(arr.filter(isHeicFile).length);
  const out = [];
  for (const f of arr) {
    try {
      out.push(await convertOne(f));
    } catch (err) {
      const reason = err?.message || String(err);
      console.error(`[heic] No se pudo convertir ${f.name}: ${reason}`);
      // NO dejamos pasar el original: un .heic que no convirtió tampoco se
      // puede leer, así que lo reportamos como salteado (una sola vez) en vez
      // de que desaparezca en silencio.
      onSkip?.({ name: f?.name || 'foto', reason: `no se pudo convertir el HEIC (${reason})` });
    }
  }
  return out;
}
