// Lectura del escaneo — port fiel de motor/Lectura.cs.
// Encuentra las 4 marcas de registro, deduce la orientación (0/90/180/270) por la
// marca de orientación, arma la homografía mm→píxel y mide el color de cada parche.
//
// `px` = { W, H, data } donde data es RGBA (4 bytes/px, orden R,G,B,A). dpiMeta es
// la resolución leída de los metadatos del archivo (o null si no vino).

import {
  Count, Markers, MarkerOuter, OrientX, OrientY, OrientSize,
  Patch, PageHmm, patchCenterMm,
} from './layout.js';
import { readCode } from './code.js';

const UMBRAL_OSCURO = 110.0;

export function lum(px, x, y) {
  const o = (y * px.W + x) * 4;
  return 0.299 * px.data[o] + 0.587 * px.data[o + 1] + 0.114 * px.data[o + 2];
}

function nombreEsquina(k) {
  switch (k) {
    case 0: return 'de arriba a la izquierda';
    case 1: return 'de arriba a la derecha';
    case 2: return 'de abajo a la derecha';
    default: return 'de abajo a la izquierda';
  }
}

// Homografía mm de la carta → píxeles del escaneo (4 puntos, h33 = 1).
// src/dst: arrays de 4 pares [x,y]. Devuelve un array de 8 o null.
export function homografia(src, dst) {
  const A = [];
  for (let i = 0; i < 8; i++) A.push(new Float64Array(9));
  for (let k = 0; k < 4; k++) {
    const x = src[k][0], y = src[k][1], u = dst[k][0], v = dst[k][1];
    const r1 = 2 * k, r2 = 2 * k + 1;
    A[r1][0] = x; A[r1][1] = y; A[r1][2] = 1; A[r1][3] = 0; A[r1][4] = 0; A[r1][5] = 0;
    A[r1][6] = -u * x; A[r1][7] = -u * y; A[r1][8] = u;
    A[r2][0] = 0; A[r2][1] = 0; A[r2][2] = 0; A[r2][3] = x; A[r2][4] = y; A[r2][5] = 1;
    A[r2][6] = -v * x; A[r2][7] = -v * y; A[r2][8] = v;
  }
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    if (piv !== c) { const t = A[c]; A[c] = A[piv]; A[piv] = t; }
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const fac = A[r][c] / A[c][c];
      for (let j = c; j < 9; j++) A[r][j] -= fac * A[c][j];
    }
  }
  const h = new Float64Array(8);
  for (let i = 0; i < 8; i++) h[i] = A[i][8] / A[i][i];
  return h;
}

export function mapear(h, x, y) {
  const w = h[6] * x + h[7] * y + 1.0;
  const u = (h[0] * x + h[1] * y + h[2]) / w;
  const v = (h[3] * x + h[4] * y + h[5]) / w;
  return [u, v];
}

function recortada(vals) {
  vals.sort((a, b) => a - b);
  const n = vals.length;
  const corte = Math.trunc(n / 10);
  let s = 0, c = 0;
  for (let i = corte; i < n - corte; i++) { s += vals[i]; c++; }
  return c > 0 ? s / c : vals[Math.trunc(n / 2)];
}

function desv(vals) {
  let m = 0;
  for (const x of vals) m += x;
  m /= vals.length;
  let s = 0;
  for (const x of vals) s += (x - m) * (x - m);
  return Math.sqrt(s / vals.length);
}

// Promedio recortado (sin el 10% más claro ni el más oscuro) de un cuadrado
// centrado en (cxMm, cyMm). Devuelve { lum, rgb:[r,g,b], desvio }.
function promedioZona(px, h, cxMm, cyMm, halfMm, wantRgb) {
  const [u, v] = mapear(h, cxMm, cyMm);
  const [ux, vx] = mapear(h, cxMm + halfMm, cyMm);
  const [uy, vy] = mapear(h, cxMm, cyMm + halfMm);
  const hx = Math.sqrt((ux - u) * (ux - u) + (vx - v) * (vx - v));
  const hy = Math.sqrt((uy - u) * (uy - u) + (vy - v) * (vy - v));
  const half = Math.trunc(Math.max(1, Math.floor(Math.min(hx, hy))));
  const cxp = Math.round(u), cyp = Math.round(v);

  const R = [], G = [], B = [];
  for (let y = cyp - half; y <= cyp + half; y++) {
    for (let x = cxp - half; x <= cxp + half; x++) {
      if (x < 0 || y < 0 || x >= px.W || y >= px.H) continue;
      const o = (y * px.W + x) * 4;
      R.push(px.data[o]);
      G.push(px.data[o + 1]);
      B.push(px.data[o + 2]);
    }
  }
  if (R.length === 0) return { lum: 255, rgb: [255, 255, 255], desvio: 0 };
  const r = recortada(R), g = recortada(G), b = recortada(B);
  const out = { lum: 0.299 * r + 0.587 * g + 0.114 * b };
  if (wantRgb) {
    out.rgb = [r, g, b];
    out.desvio = (desv(R) + desv(G) + desv(B)) / 3.0;
  }
  return out;
}

// Busca el anillo negro en una esquina de la imagen (25% del ancho y alto).
function buscarMarca(px, k, dpi) {
  const ww = Math.trunc(px.W * 0.25);
  const wh = Math.trunc(px.H * 0.25);
  const x0 = (k === 1 || k === 2) ? px.W - ww : 0;
  const y0 = (k >= 2) ? px.H - wh : 0;

  const f = Math.max(1, Math.round(dpi / 75.0)); // se busca a ~75 dpi
  const rw = Math.trunc(ww / f);
  const rh = Math.trunc(wh / f);
  if (rw < 4 || rh < 4) return null;

  const oscuro = new Uint8Array(rw * rh);
  for (let ry = 0; ry < rh; ry++) {
    for (let rx = 0; rx < rw; rx++) {
      let s = 0, n = 0;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          s += lum(px, x0 + rx * f + dx, y0 + ry * f + dy);
          n++;
        }
      }
      oscuro[ry * rw + rx] = (s / n) < UMBRAL_OSCURO ? 1 : 0;
    }
  }

  const pxPorMm = dpi / 25.4 / f;
  const esperado = MarkerOuter * pxPorMm;
  const visto = new Uint8Array(rw * rh);
  const cola = new Int32Array(rw * rh);
  const ecx = (k === 1 || k === 2) ? rw : 0;
  const ecy = (k >= 2) ? rh : 0;
  let mejorDist = Infinity;
  let hallado = false;
  let bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;

  for (let i = 0; i < rw * rh; i++) {
    if (!oscuro[i] || visto[i]) continue;
    let head = 0, tail = 0;
    cola[tail++] = i;
    visto[i] = 1;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, cnt = 0;
    let tocaBorde = false;
    while (head < tail) {
      const p = cola[head++];
      const x = p % rw, y = Math.trunc(p / rw);
      cnt++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === rw - 1 || y === rh - 1) tocaBorde = true;
      if (x > 0 && oscuro[p - 1] && !visto[p - 1]) { visto[p - 1] = 1; cola[tail++] = p - 1; }
      if (x < rw - 1 && oscuro[p + 1] && !visto[p + 1]) { visto[p + 1] = 1; cola[tail++] = p + 1; }
      if (y > 0 && oscuro[p - rw] && !visto[p - rw]) { visto[p - rw] = 1; cola[tail++] = p - rw; }
      if (y < rh - 1 && oscuro[p + rw] && !visto[p + rw]) { visto[p + rw] = 1; cola[tail++] = p + rw; }
    }
    if (tocaBorde) continue;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (bw < esperado * 0.6 || bw > esperado * 1.5 || bh < esperado * 0.6 || bh > esperado * 1.5) continue;
    const asp = bw / bh;
    if (asp < 0.7 || asp > 1.43) continue;
    const fill = cnt / (bw * bh);
    if (fill < 0.5 || fill > 0.97) continue; // anillo, no cuadrado macizo
    const mx = (minX + maxX) / 2.0, my = (minY + maxY) / 2.0;
    const d = (mx - ecx) * (mx - ecx) + (my - ecy) * (my - ecy);
    if (d < mejorDist) {
      mejorDist = d;
      hallado = true;
      bx0 = minX; by0 = minY; bx1 = maxX; by1 = maxY;
    }
  }
  if (!hallado) return null;

  // Refinar a resolución completa: centroide de los píxeles oscuros del anillo.
  const fx0 = Math.max(0, x0 + (bx0 - 1) * f);
  const fy0 = Math.max(0, y0 + (by0 - 1) * f);
  const fx1 = Math.min(px.W - 1, x0 + (bx1 + 2) * f);
  const fy1 = Math.min(px.H - 1, y0 + (by1 + 2) * f);
  let sx = 0, sy = 0, sn = 0;
  for (let y = fy0; y <= fy1; y++) {
    for (let x = fx0; x <= fx1; x++) {
      if (lum(px, x, y) < UMBRAL_OSCURO) { sx += x; sy += y; sn++; }
    }
  }
  if (sn === 0) return null;
  return [sx / sn, sy / sn];
}

// Mide el escaneo. Devuelve { rgb:Float64Array(Count*3), desvio, dpiEstimado, rotacionGrados, log, code }.
// opts.leerCodigo=true → lee el código legible por máquina de la banda inferior (code).
export function medir(px, nombre, dpiMeta, opts = {}) {
  const log = [];
  const dpi = (dpiMeta >= 100 && dpiMeta <= 1200)
    ? dpiMeta
    : Math.max(px.W, px.H) / (PageHmm / 25.4);
  log.push(nombre + ': ' + px.W + 'x' + px.H + ' px, aprox. ' + Math.round(dpi) + ' dpi');

  // Esquinas de la IMAGEN en sentido horario.
  const esquinas = [];
  for (let k = 0; k < 4; k++) {
    const e = buscarMarca(px, k, dpi);
    if (!e) {
      throw new Error(nombre + ': no encontré la marca de registro de la esquina ' + nombreEsquina(k)
        + '. Revisá que la hoja entre entera en el escaneo, derecha y apoyada contra el borde del vidrio.');
    }
    esquinas.push(e);
  }

  // Probar las 4 formas en que pudo quedar apoyada la hoja. La correcta es la única
  // en la que la marca de orientación cae sobre algo oscuro.
  let mejorLum = Infinity, segundaLum = Infinity, mejorS = -1, mejorH = null;
  for (let s = 0; s < 4; s++) {
    const src = [], dst = [];
    for (let k = 0; k < 4; k++) {
      src.push([Markers[k][0], Markers[k][1]]);
      dst.push(esquinas[(k + s) % 4]);
    }
    const h = homografia(src, dst);
    if (!h) continue;
    const L = promedioZona(px, h, OrientX, OrientY, OrientSize * 0.3, false).lum;
    if (L < mejorLum) { segundaLum = mejorLum; mejorLum = L; mejorS = s; mejorH = h; }
    else if (L < segundaLum) { segundaLum = L; }
  }
  if (!mejorH || mejorLum > 120) {
    throw new Error(nombre + ': encontré las marcas pero no pude saber la orientación de la hoja. ¿Es la carta de color de este kit?');
  }
  const rotacionGrados = mejorS * 90;
  log.push('  orientación: ' + rotacionGrados + '°  (marca ' + Math.round(mejorLum) + ' vs siguiente ' + Math.round(segundaLum) + ')');
  if (segundaLum < 160) log.push('  AVISO: la orientación no quedó del todo clara; revisar el escaneo.');

  const rgb = new Float64Array(Count * 3);
  const desvio = new Float64Array(Count);
  let sumaDesvio = 0, maxDesvio = 0;
  for (let i = 0; i < Count; i++) {
    const [cx, cy] = patchCenterMm(i);
    const z = promedioZona(px, mejorH, cx, cy, Patch * 0.25, true);
    rgb[i * 3 + 0] = z.rgb[0];
    rgb[i * 3 + 1] = z.rgb[1];
    rgb[i * 3 + 2] = z.rgb[2];
    desvio[i] = z.desvio;
    sumaDesvio += z.desvio;
    if (z.desvio > maxDesvio) maxDesvio = z.desvio;
  }
  const promDesvio = sumaDesvio / Count;
  log.push('  ruido dentro de los parches: promedio ' + fmt1(promDesvio) + ', máximo ' + fmt1(maxDesvio));
  if (promDesvio > 20) log.push('  AVISO: mucho ruido dentro de los parches (¿escaneo movido, borroso o muy comprimido?).');

  let code = null;
  if (opts.leerCodigo) {
    const sampleLum = (cxMm, cyMm, halfMm) => promedioZona(px, mejorH, cxMm, cyMm, halfMm, false).lum;
    code = readCode(sampleLum);
  }

  return { rgb, desvio, dpiEstimado: dpi, rotacionGrados, log: log.join('\n') + '\n', code };
}

// Formato con coma decimal, 1 decimal, redondeo half-away (como .NET Framework).
function fmt1(n) {
  const r = Math.sign(n) * Math.round(Math.abs(n) * 10) / 10;
  return r.toFixed(1).replace('.', ',');
}
