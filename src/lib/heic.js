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

// Detecta el tipo REAL por los primeros bytes (la extensión a veces miente:
// archivos .heic que en realidad son JPEG/PNG, típico al compartir/descargar
// fotos). Devuelve 'jpeg' | 'png' | 'heif' | 'unknown'.
async function sniffImageKind(file) {
  try {
    const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
    // 'ftyp' en bytes 4..7 => contenedor HEIF/HEIC (o AVIF).
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'heif';
  } catch {
    // Si no se puede leer la cabecera, caemos al criterio por extensión.
  }
  return 'unknown';
}

// Devuelve un File listo para el pipeline. Manda el CONTENIDO real, no la
// extensión: un .heic que en verdad es JPEG/PNG se deja pasar con nombre/tipo
// corregidos (NO se intenta convertir, fallaría); un HEIF real se convierte a
// JPEG. Conserva el nombre base (cambiando la extensión cuando hace falta).
async function convertOne(file) {
  const kind = await sniffImageKind(file);
  if (kind === 'jpeg' || kind === 'png') {
    if (!isHeicFile(file)) return file; // .jpg/.png normal: pasa igual.
    // .heic que en realidad es JPEG/PNG: corregimos nombre y tipo.
    const ext = kind === 'png' ? '.png' : '.jpg';
    const type = kind === 'png' ? 'image/png' : 'image/jpeg';
    const newName = (file.name || 'foto').replace(/(\.(heic|heif))+$/i, '') + ext;
    return new File([file], newName, { type, lastModified: file.lastModified });
  }
  // HEIF real, o no se pudo identificar pero la extensión dice heic: convertir.
  if (kind === 'heif' || isHeicFile(file)) {
    const out = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
    const newName = (file.name || 'foto').replace(/(\.(heic|heif))+$/i, '') + '.jpg';
    return new File([out], newName, { type: 'image/jpeg', lastModified: file.lastModified });
  }
  return file;
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
