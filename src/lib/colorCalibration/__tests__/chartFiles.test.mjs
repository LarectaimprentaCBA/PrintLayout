// La carta de prueba tiene que salir en PDF A4 a TAMAÑO REAL, sin márgenes ni
// escalado. Si sale escalada, los 343 parches no caen donde el lector los
// busca y el escaneo no se puede medir.
//
// Corre con: npm run test:chart-files

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { pngAPdfA4 } from '../chartFiles.js';
import { PageWmm, PageHmm } from '../layout.js';

let pass = 0;
let fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; } else { fail++; console.log(`  FALLA ${n}  ${e}`); } };

// PNG mínimo válido, de un color sólido, para poder medirlo al rasterizar.
function pngSolido(r, g, b, W = 4, H = 4) {
  const tabla = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = tabla[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (tipo, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(tipo, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // 8 bits por canal, RGB
  const filas = [];
  for (let y = 0; y < H; y++) {
    const fila = Buffer.alloc(1 + W * 3);
    for (let x = 0; x < W; x++) { fila[1 + x * 3] = r; fila[2 + x * 3] = g; fila[3 + x * 3] = b; }
    filas.push(fila);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(filas))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-carta-'));
const COLOR = [0, 128, 255];
const pdfBytes = await pngAPdfA4(pngSolido(...COLOR));
const pdfPath = path.join(dir, 'carta.pdf');
fs.writeFileSync(pdfPath, Buffer.from(pdfBytes));
console.log(`PDF generado: ${(pdfBytes.length / 1024).toFixed(1)} KB`);

// ── 1) tamaño de hoja (lo leemos con pdf-lib: el PDF va comprimido) ─────────
const doc = await PDFDocument.load(pdfBytes);
check('tiene 1 hoja', doc.getPageCount() === 1, String(doc.getPageCount()));
const { width: wPt, height: hPt } = doc.getPage(0).getSize();
const wMm = (wPt / 72) * 25.4;
const hMm = (hPt / 72) * 25.4;
console.log(`  hoja: ${wPt.toFixed(2)} x ${hPt.toFixed(2)} pt  =  ${wMm.toFixed(2)} x ${hMm.toFixed(2)} mm`);
check(`ancho = ${PageWmm} mm`, Math.abs(wMm - PageWmm) < 0.05, wMm.toFixed(2));
check(`alto = ${PageHmm} mm`, Math.abs(hMm - PageHmm) < 0.05, hMm.toFixed(2));

// ── 2) rasterizado real: la imagen cubre TODA la hoja, sin márgenes ─────────
const GS = path.resolve('ghostscript/bin/gswin64c.exe');
if (fs.existsSync(GS)) {
  const ppm = path.join(dir, 'p.ppm');
  try {
    execFileSync(GS, ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=ppmraw', '-r72',
      `-sOutputFile=${ppm}`, pdfPath], { stdio: 'pipe' });
  } catch (err) {
    console.log(`  Ghostscript falló: ${(err.stderr || '').toString().trim().slice(0, 200)}`);
  }
  if (fs.existsSync(ppm)) {
    const b = fs.readFileSync(ppm);
    let p = 0;
    // Ghostscript mete una línea de comentario después de "P6": hay que saltearla.
    const tok = () => {
      while ([32, 10, 13, 9].includes(b[p])) p++;
      if (b[p] === 35) { while (b[p] !== 10) p++; return tok(); }
      const s = p;
      while (![32, 10, 13, 9].includes(b[p])) p++;
      return b.slice(s, p).toString();
    };
    tok();
    const W = +tok();
    const H = +tok();
    tok();
    p++;
    console.log(`  rasterizado a 72 dpi: ${W} x ${H} px`);
    check('ancho en px = A4 a 72 dpi (595)', Math.abs(W - 595) <= 1, String(W));
    check('alto en px = A4 a 72 dpi (842)', Math.abs(H - 842) <= 1, String(H));
    const px = b.slice(p);
    const color = (x, y) => [px[(y * W + x) * 3], px[(y * W + x) * 3 + 1], px[(y * W + x) * 3 + 2]];
    const cerca = (c) => c.every((v, i) => Math.abs(v - COLOR[i]) <= 6);
    // Las 4 esquinas y el centro: con margen o escalado, alguna saldría blanca.
    const puntos = [[1, 1], [W - 2, 1], [1, H - 2], [W - 2, H - 2], [W >> 1, H >> 1]];
    const malas = puntos.filter(([x, y]) => !cerca(color(x, y)));
    check('la imagen cubre toda la hoja (sin márgenes ni escalado)', malas.length === 0,
      malas.map(([x, y]) => `(${x},${y})=${color(x, y)}`).join(' '));
  } else {
    check('Ghostscript generó el rasterizado', false, 'no se creó el archivo');
  }
} else {
  console.log('  (sin Ghostscript: salteo el rasterizado)');
}

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* nada */ }
console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exit(fail ? 1 : 0);
