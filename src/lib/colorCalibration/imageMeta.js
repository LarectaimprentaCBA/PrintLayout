// Lee la resolución (DPI) de los metadatos del archivo de imagen, porque nativeImage
// y createImageBitmap no la exponen. La orden pide usar la resolución de los metadatos
// y estimarla solo si no viene. Soporta JPEG (JFIF/EXIF) y PNG (pHYs).
// bytes: Uint8Array. Devuelve dpi (número) o null.

export function parseDpi(bytes) {
  if (!bytes || bytes.length < 24) return null;
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return pngDpi(bytes);
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegDpi(bytes);
  return null;
}

function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
function u32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }

function pngDpi(b) {
  let o = 8; // saltar firma
  while (o + 8 <= b.length) {
    const len = u32(b, o);
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    if (type === 'pHYs' && o + 8 + 9 <= b.length) {
      const ppuX = u32(b, o + 8);
      const unit = b[o + 8 + 8];
      if (unit === 1 && ppuX > 0) return ppuX * 0.0254; // px/m → px/inch
      return null;
    }
    if (type === 'IDAT' || type === 'IEND') break;
    o += 12 + len; // len + type(4) + data + crc(4)
  }
  return null;
}

function jpegDpi(b) {
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) { o++; continue; }
    const marker = b[o + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS
    const len = u16(b, o + 2);
    if (len < 2) break;
    const seg = o + 4;
    // APP0 JFIF
    if (marker === 0xe0 && seg + 12 <= b.length &&
        b[seg] === 0x4a && b[seg + 1] === 0x46 && b[seg + 2] === 0x49 && b[seg + 3] === 0x46 && b[seg + 4] === 0x00) {
      const units = b[seg + 7];
      const xd = u16(b, seg + 8);
      if (xd > 0) {
        if (units === 1) return xd;          // dots/inch
        if (units === 2) return xd * 2.54;   // dots/cm → dots/inch
      }
    }
    // APP1 EXIF (XResolution tag 0x011A + ResolutionUnit 0x0128)
    if (marker === 0xe1 && seg + 6 <= b.length &&
        b[seg] === 0x45 && b[seg + 1] === 0x78 && b[seg + 2] === 0x69 && b[seg + 3] === 0x66) {
      const dpi = exifDpi(b, seg + 6);
      if (dpi) return dpi;
    }
    o += 2 + len;
  }
  return null;
}

function exifDpi(b, tiff) {
  if (tiff + 8 > b.length) return null;
  const le = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  const rd16 = (o) => le ? (b[o] | (b[o + 1] << 8)) : ((b[o] << 8) | b[o + 1]);
  const rd32 = (o) => le ? ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0)
                         : (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  const ifd0 = tiff + rd32(tiff + 4);
  if (ifd0 + 2 > b.length) return null;
  const n = rd16(ifd0);
  let xres = null, unit = 2;
  for (let i = 0; i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    if (e + 12 > b.length) break;
    const tag = rd16(e);
    if (tag === 0x011a) { const off = tiff + rd32(e + 8); if (off + 8 <= b.length) xres = rd32(off) / rd32(off + 4); }
    else if (tag === 0x0128) unit = rd16(e + 8);
  }
  if (xres && xres > 0) return unit === 3 ? xres * 2.54 : xres; // 3 = cm
  return null;
}
