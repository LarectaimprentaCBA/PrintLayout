// Renderiza la pagina 1 de un PDF (en base64) a un dataURL JPEG para
// usar como fondo visual del canvas. Cachea por id de plantilla.
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const cache = new Map();

function base64ToBytes(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Rasteriza todas las paginas de un PDF (bytes) a JPEG dataURLs en el DPI
// pedido. Lo usa el flujo de impresion porque webContents.print() sobre un
// PDF cargado en Electron sale en blanco; imprimir HTML con <img> si funciona.
export async function renderPdfBytesToImages(bytes, dpi = 240, quality = 0.92) {
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  try {
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      // Fondo blanco explicito: el PDF puede ser transparente y la impresora
      // entonces deja la celda en gris/transparente.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      out.push(canvas.toDataURL('image/jpeg', quality));
    }
    return out;
  } finally {
    doc.destroy();
  }
}

export async function renderPdfPage1Preview(template, dpi = 96) {
  if (!template?.pdfBase64) return null;
  const key = `${template.id}:${dpi}`;
  if (cache.has(key)) return cache.get(key);

  const bytes = base64ToBytes(template.pdfBase64);
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  try {
    const page = await doc.getPage(1);
    // pdf.js: 1 unidad = 1pt. Para dpi pasamos scale = dpi / 72.
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    cache.set(key, dataUrl);
    return dataUrl;
  } finally {
    doc.destroy();
  }
}
