// Lee el DPI declarado por un archivo JPG/PNG. Si no se puede determinar,
// devuelve null. Suficiente para calcular tamanio fisico aproximado.

export async function readImageDpi(file) {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);

  // JPEG: FFD8...
  if (view.byteLength > 2 && view.getUint16(0) === 0xffd8) {
    return readJpegDpi(view);
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (view.byteLength > 8
      && view.getUint32(0) === 0x89504e47
      && view.getUint32(4) === 0x0d0a1a0a) {
    return readPngDpi(view);
  }
  return null;
}

function readJpegDpi(view) {
  let offset = 2;
  // Recorrer marcadores buscando JFIF (APP0) o EXIF (APP1).
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset);
    offset += 2;
    if (marker === 0xffd9 || marker === 0xffda) break; // EOI o SOS
    if ((marker & 0xff00) !== 0xff00) break;
    const segLen = view.getUint16(offset);
    if (segLen < 2) break;

    if (marker === 0xffe0 && offset + segLen <= view.byteLength) {
      // APP0 - JFIF.
      const ident =
        String.fromCharCode(view.getUint8(offset + 2)) +
        String.fromCharCode(view.getUint8(offset + 3)) +
        String.fromCharCode(view.getUint8(offset + 4)) +
        String.fromCharCode(view.getUint8(offset + 5));
      if (ident === 'JFIF') {
        const units = view.getUint8(offset + 9);
        const xd = view.getUint16(offset + 10);
        const yd = view.getUint16(offset + 12);
        if (units === 1) return { xDpi: xd, yDpi: yd };
        if (units === 2) return { xDpi: xd * 2.54, yDpi: yd * 2.54 };
      }
    }

    if (marker === 0xffe1 && offset + segLen <= view.byteLength) {
      // APP1 - EXIF.
      const ident =
        String.fromCharCode(view.getUint8(offset + 2)) +
        String.fromCharCode(view.getUint8(offset + 3)) +
        String.fromCharCode(view.getUint8(offset + 4)) +
        String.fromCharCode(view.getUint8(offset + 5));
      if (ident === 'Exif') {
        const tiffStart = offset + 8;
        const dpi = readExifDpi(view, tiffStart);
        if (dpi) return dpi;
      }
    }

    offset += segLen;
  }
  return null;
}

function readExifDpi(view, tiffStart) {
  if (tiffStart + 8 > view.byteLength) return null;
  const byteOrder = view.getUint16(tiffStart);
  const little = byteOrder === 0x4949; // 'II'
  const big = byteOrder === 0x4d4d; // 'MM'
  if (!little && !big) return null;
  const u16 = (o) => view.getUint16(o, little);
  const u32 = (o) => view.getUint32(o, little);

  if (u16(tiffStart + 2) !== 0x002a) return null; // TIFF magic 42
  const ifd0Off = u32(tiffStart + 4);
  if (tiffStart + ifd0Off + 2 > view.byteLength) return null;
  const numEntries = u16(tiffStart + ifd0Off);

  let xRes = null;
  let yRes = null;
  let unit = 2; // 2 = inch (default), 3 = cm
  for (let i = 0; i < numEntries; i++) {
    const entryOff = tiffStart + ifd0Off + 2 + i * 12;
    if (entryOff + 12 > view.byteLength) break;
    const tag = u16(entryOff);
    const type = u16(entryOff + 2);
    const valOff = u32(entryOff + 8);
    if (tag === 0x011a && type === 5 /* RATIONAL */) {
      const off = tiffStart + valOff;
      if (off + 8 <= view.byteLength) {
        const num = u32(off);
        const den = u32(off + 4);
        if (den) xRes = num / den;
      }
    } else if (tag === 0x011b && type === 5) {
      const off = tiffStart + valOff;
      if (off + 8 <= view.byteLength) {
        const num = u32(off);
        const den = u32(off + 4);
        if (den) yRes = num / den;
      }
    } else if (tag === 0x0128 && type === 3 /* SHORT */) {
      unit = u16(entryOff + 8);
    }
  }
  if (xRes && yRes) {
    if (unit === 3) return { xDpi: xRes * 2.54, yDpi: yRes * 2.54 };
    return { xDpi: xRes, yDpi: yRes };
  }
  return null;
}

function readPngDpi(view) {
  // PNG: chunks. Cada chunk: length (4) + type (4) + data + crc (4).
  let offset = 8;
  while (offset + 8 < view.byteLength) {
    const length = view.getUint32(offset);
    const type =
      String.fromCharCode(view.getUint8(offset + 4)) +
      String.fromCharCode(view.getUint8(offset + 5)) +
      String.fromCharCode(view.getUint8(offset + 6)) +
      String.fromCharCode(view.getUint8(offset + 7));
    const dataOff = offset + 8;
    if (type === 'pHYs' && length >= 9 && dataOff + 9 <= view.byteLength) {
      const ppuX = view.getUint32(dataOff);
      const ppuY = view.getUint32(dataOff + 4);
      const unit = view.getUint8(dataOff + 8);
      if (unit === 1) {
        // pixels per meter -> DPI.
        return { xDpi: ppuX * 0.0254, yDpi: ppuY * 0.0254 };
      }
      return null;
    }
    if (type === 'IDAT' || type === 'IEND') break;
    offset = dataOff + length + 4;
  }
  return null;
}
