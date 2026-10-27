// Leer un escaneo de la carta de color, de punta a punta: archivo -> píxeles -> medición.
//
// Pasó de verdad (27/10/2026): al calibrar, la app contestaba "no encontré la marca de
// registro de la esquina de arriba a la izquierda" con escaneos PERFECTOS. La culpa no
// era de las marcas: fileToPixels leía bitmap.width DESPUÉS de bitmap.close(), y el
// estándar manda que cerrar un ImageBitmap deje width y height en 0. O sea, el escaneo
// salía de ahí como una imagen de 0x0 y el lector culpaba a lo primero que no encontraba.
// Verificado en Electron: antes de close() 2480x3508, después 0x0.
//
// Por eso acá el ImageBitmap de mentira se cierra IGUAL que el de verdad.
//
// Corre con: npm run test:scan-read

import { drawChart } from '../chart.js';
import { fileToPixels } from '../analyze.js';
import { medir } from '../reader.js';
import { px as mmToPx, PageWmm, PageHmm } from '../layout.js';
import { ROLE_REFERENCE, ROLE_CORRECT } from '../code.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};

// ── Un contexto 2D de mentira, lo justo para que drawChart dibuje ────────────
function parseColor(v) {
  if (v === '#fff' || v === '#ffffff') return [255, 255, 255];
  if (v === '#000' || v === '#000000') return [0, 0, 0];
  const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(String(v).replace(/\s/g, ''));
  return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
}

function lienzo(W, H) {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  let color = [0, 0, 0];
  const ctx = {
    textBaseline: '', font: '', imageSmoothingEnabled: false,
    get fillStyle() { return color; },
    set fillStyle(v) { color = parseColor(v); },
    fillRect(x, y, w, h) {
      const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
      const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * W + xx) * 4;
          data[o] = color[0]; data[o + 1] = color[1]; data[o + 2] = color[2]; data[o + 3] = 255;
        }
      }
    },
    fillText() { /* el rótulo humano no se mide */ },
  };
  return { W, H, data, ctx };
}

// Carta sintética como saldría de un escaneo perfecto a 240 dpi.
function cartaEscaneada(sessionId, role) {
  const l = lienzo(mmToPx(PageWmm), mmToPx(PageHmm));
  drawChart(l.ctx, { etiqueta: 'PRUEBA', sessionId, role, withCode: true });
  return { W: l.W, H: l.H, data: l.data };
}

function girar90(p) {
  const W = p.H, H = p.W;
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = ((p.H - 1 - x) * p.W + y) * 4, n = (y * W + x) * 4;
      d[n] = p.data[o]; d[n + 1] = p.data[o + 1]; d[n + 2] = p.data[o + 2]; d[n + 3] = 255;
    }
  }
  return { W, H, data: d };
}

// ── Un File/Blob/canvas de mentira, con el close() que rompe ─────────────────
// Cabecera JFIF mínima que declara la resolución, para que parseDpi tenga qué leer.
function jpegFalso(dpi) {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x01, (dpi >> 8) & 0xff, dpi & 0xff, (dpi >> 8) & 0xff, dpi & 0xff,
    0x00, 0x00, 0xff, 0xd9, 0x00, 0x00,
  ]);
}

function montarNavegador(pix, { cerrarDejaEnCero = true } = {}) {
  globalThis.createImageBitmap = async () => {
    const b = {
      width: pix.W, height: pix.H, _data: pix.data,
      close() { if (cerrarDejaEnCero) { b.width = 0; b.height = 0; } },
    };
    return b;
  };
  globalThis.document = {
    createElement() {
      const c = { width: 0, height: 0, _bmp: null };
      c.getContext = () => ({
        drawImage(bmp) { c._bmp = bmp; },
        getImageData(x, y, w, h) {
          const src = c._bmp ? c._bmp._data : new Uint8ClampedArray(0);
          return { width: w, height: h, data: src.slice(0, Math.max(0, w * h * 4)) };
        },
      });
      return c;
    },
  };
}

const archivo = (bytes, name) => ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

console.log('\n1) fileToPixels sobrevive a bitmap.close() (EL BUG)');
{
  const pix = cartaEscaneada(1234, ROLE_REFERENCE);
  montarNavegador(pix);
  const { px: got, dpi } = await fileToPixels(archivo(jpegFalso(240), 'carta.jpg'));
  check('devuelve el ancho de verdad', got.W === pix.W, `${got.W} (esperaba ${pix.W})`);
  check('devuelve el alto de verdad', got.H === pix.H, `${got.H} (esperaba ${pix.H})`);
  check('los píxeles son todos', got.data.length === pix.W * pix.H * 4, String(got.data.length));
  check('lee la resolución del archivo', dpi === 240, String(dpi));
}

console.log('\n2) De punta a punta: archivo -> medición (lo que hace el asistente)');
{
  for (const [rol, nombreRol] of [[ROLE_REFERENCE, 'referencia'], [ROLE_CORRECT, 'a corregir']]) {
    const pix = cartaEscaneada(40517, rol);
    montarNavegador(pix);
    const { px: got, dpi } = await fileToPixels(archivo(jpegFalso(240), 'carta.jpg'));
    let m = null, err = null;
    try { m = medir(got, 'escaneo', dpi, { leerCodigo: true }); } catch (e) { err = e.message; }
    check(`mide la carta ${nombreRol}`, !!m, err || '');
    if (m) {
      check(`  lee el id de sesión (${nombreRol})`, m.code && m.code.sessionId === 40517, JSON.stringify(m.code));
      check(`  lee el rol (${nombreRol})`, m.code && m.code.role === rol, JSON.stringify(m.code));
      check(`  la hoja sale derecha (${nombreRol})`, m.rotacionGrados === 0, String(m.rotacionGrados));
    }
  }
}

console.log('\n3) La hoja apoyada de cualquier lado se lee igual');
{
  let pix = cartaEscaneada(777, ROLE_CORRECT);
  for (const grados of [90, 180, 270]) {
    pix = girar90(pix);
    let m = null, err = null;
    try { m = medir(pix, 'escaneo', 240, { leerCodigo: true }); } catch (e) { err = e.message; }
    check(`girada ${grados}°: la mide`, !!m, err || '');
    if (m) check(`girada ${grados}°: lee el código`, m.code && m.code.sessionId === 777, JSON.stringify(m.code));
  }
}

console.log('\n4) Si la imagen viene mal, lo dice (y no culpa a las marcas)');
{
  const casos = [
    ['vacía (0x0)', { W: 0, H: 0, data: new Uint8ClampedArray(0) }, /no pude abrir la imagen/i],
    ['sin píxeles', { W: 100, H: 100, data: null }, /no pude abrir la imagen/i],
    ['cortada', { W: 1000, H: 1000, data: new Uint8ClampedArray(400) }, /cortada/i],
    ['miniatura', { W: 300, H: 420, data: new Uint8ClampedArray(300 * 420 * 4) }, /demasiado chico/i],
  ];
  for (const [nombre, p, re] of casos) {
    let msg = '(no lanzó)';
    try { medir(p, 'escaneo', 300, {}); } catch (e) { msg = e.message; }
    check(`${nombre}: el mensaje explica qué pasa`, re.test(msg), msg);
    check(`${nombre}: no habla de marcas de registro`, !/marca de registro/i.test(msg), msg);
  }
}

console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exit(fail ? 1 : 0);
