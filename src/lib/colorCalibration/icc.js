// Generador de PERFIL ICC (.icc) a partir de una calibración de PrintLayout.
//
// PARA QUÉ: la corrección de la Ricoh .198 vive adentro de PrintLayout; Corel no
// la usa. Exportándola como perfil de impresora, cuando Corel convierte los
// colores del diseño a este perfil le manda a la impresora EXACTAMENTE el mismo
// valor que manda PrintLayout hoy.
//
// IDEA (L = tabla de la calibración; para un color deseado c, L(c) = lo que hay
// que mandarle a la impresora para que salga bien):
//   B2A (PCS -> dispositivo) = Lab_D50 -> sRGB -> L -> RGB de salida
//                              (este es el camino que usa Corel al imprimir)
//   A2B (dispositivo -> PCS) = RGB -> L⁻¹ -> sRGB -> Lab_D50
//
// ── TRES TRAMPAS ────────────────────────────────────────────────────────────
// 1) BLANCO DISTINTO. El motor de calibración (colorMath.rgbToLab) trabaja en
//    Lab *D65*. El PCS de ICC es Lab *D50*. Acá usamos D50 con la matriz sRGB
//    ya adaptada por Bradford (la misma del perfil sRGB estándar) para que el
//    ida y vuelta contra el sRGB de Corel/Windows cierre exacto.
//    NO reusar rgbToLab() de colorMath para esto.
// 2) LA CODIFICACIÓN Lab DE ICC v2 NO ES LA DE v4. En v2 (la que escribimos,
//    por compatibilidad) el 16-bit usa 0xFF00 = 100 para L y 0xFF00 = +127 para
//    a/b, NO 0xFFFF. Con la de v4 el perfil sale con los colores corridos y
//    nada avisa. Ver labToPcs16 / pcs16ToLab.
// 3) ORDEN DEL CLUT: el PRIMER canal de entrada es el que varía MÁS LENTO.
//
// El módulo es PURO (sin DOM ni Node): devuelve un Uint8Array con el .icc.

import { Lut3 } from './colorMath.js';

// ── Escritura binaria (ICC es big-endian) ───────────────────────────────────
class Writer {
  constructor() { this.bytes = []; }

  get length() { return this.bytes.length; }

  u8(v) { this.bytes.push(v & 0xff); return this; }

  u16(v) { this.bytes.push((v >>> 8) & 0xff, v & 0xff); return this; }

  u32(v) {
    this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    return this;
  }

  // s15Fixed16Number: con signo, 16 bits enteros + 16 de fracción.
  s15f16(v) { return this.u32(Math.round(v * 65536) | 0); }

  ascii(s) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i) & 0xff); return this; }

  sig(s) { return this.ascii(`${s}    `.slice(0, 4)); }

  zeros(n) { for (let i = 0; i < n; i++) this.u8(0); return this; }

  pad4() { while (this.bytes.length % 4 !== 0) this.u8(0); return this; }

  push(arr) { for (const b of arr) this.u8(b); return this; }

  toUint8Array() { return Uint8Array.from(this.bytes); }
}

// ── Color: sRGB <-> XYZ(D50) <-> Lab(D50) ───────────────────────────────────
// Matriz del perfil sRGB ESTÁNDAR, ya adaptada a D50 por Bradford. Usar ESTA y
// no la de D65 es lo que hace que el ida y vuelta con Corel cierre exacto.
const SRGB_TO_XYZ_D50 = [
  [0.4360747, 0.3850649, 0.1430804],
  [0.2225045, 0.7168786, 0.0606169],
  [0.0139322, 0.0971045, 0.7141733],
];
const XYZ_D50_TO_SRGB = [
  [3.1338561, -1.6168667, -0.4906146],
  [-0.9787684, 1.9161415, 0.0334540],
  [0.0719453, -0.2289914, 1.4052427],
];
const WHITE_D50 = [0.96422, 1.0, 0.82491];

const clamp255 = (v) => (v < 0 ? 0 : (v > 255 ? 255 : v));

function srgbToLinear(c) {
  const u = Math.max(0, Math.min(255, c)) / 255;
  return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
}
function linearToSrgb(u) {
  const v = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(Math.max(u, 0), 1 / 2.4) - 0.055;
  return clamp255(v * 255);
}
const fFwd = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
const fInv = (t) => (t * t * t > 216 / 24389 ? t * t * t : (t - 4 / 29) / (841 / 108));

/** sRGB 0..255 -> Lab D50 */
export function srgbToLabD50(r, g, b) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const M = SRGB_TO_XYZ_D50;
  const X = (M[0][0] * R + M[0][1] * G + M[0][2] * B) / WHITE_D50[0];
  const Y = (M[1][0] * R + M[1][1] * G + M[1][2] * B) / WHITE_D50[1];
  const Z = (M[2][0] * R + M[2][1] * G + M[2][2] * B) / WHITE_D50[2];
  const fx = fFwd(X);
  const fy = fFwd(Y);
  const fz = fFwd(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Lab D50 -> sRGB 0..255 (recortado al cubo sRGB) */
export function labD50ToSrgb(L, a, bb) {
  const s = labD50ToSrgbExt(L, a, bb);
  return [clamp255(s[0]), clamp255(s[1]), clamp255(s[2])];
}

// Gamma sRGB extendida a valores negativos (se aplica al valor absoluto y se le
// devuelve el signo). Sirve para continuar la curva FUERA del cubo sRGB.
function linearToSrgbExt(u) {
  const sgn = u < 0 ? -1 : 1;
  const a = Math.abs(u);
  const v = a <= 0.0031308 ? 12.92 * a : 1.055 * Math.pow(a, 1 / 2.4) - 0.055;
  return sgn * v * 255;
}

/**
 * Lab D50 -> sRGB **SIN recortar** (puede dar <0 o >255).
 *
 * POR QUÉ EXISTE: la tabla B2A recorre TODO el espacio Lab, y la mayor parte
 * cae FUERA de lo que el sRGB puede representar. Si ahí recortamos, la función
 * queda con un quiebre en el borde de la gama y la interpolación trilineal del
 * motor de color se va al demonio JUSTO en los colores saturados (probado: 24
 * puntos de error sobre 255 en los verdes). Extendiendo la curva en vez de
 * recortarla, la función sigue siendo suave y la interpolación da bien; el
 * recorte se hace recién al final, al escribir el valor de 16 bits.
 */
export function labD50ToSrgbExt(L, a, bb) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;
  const X = fInv(fx) * WHITE_D50[0];
  const Y = fInv(fy) * WHITE_D50[1];
  const Z = fInv(fz) * WHITE_D50[2];
  const M = XYZ_D50_TO_SRGB;
  return [
    linearToSrgbExt(M[0][0] * X + M[0][1] * Y + M[0][2] * Z),
    linearToSrgbExt(M[1][0] * X + M[1][1] * Y + M[1][2] * Z),
    linearToSrgbExt(M[2][0] * X + M[2][1] * Y + M[2][2] * Z),
  ];
}

// ── Codificación Lab de ICC v2 (¡NO es la de v4!) ───────────────────────────
// L: 0..100 -> 0x0000..0xFF00 ; a/b: -128..+127 -> 0x0000..0xFF00
const LAB_V2_MAX = 0xff00;

export function labToPcs16(L, a, b) {
  const e = (v) => Math.max(0, Math.min(0xffff, Math.round(v)));
  return [
    e((L / 100) * LAB_V2_MAX),
    e(((a + 128) / 255) * LAB_V2_MAX),
    e(((b + 128) / 255) * LAB_V2_MAX),
  ];
}

export function pcs16ToLab(l16, a16, b16) {
  return [
    (l16 / LAB_V2_MAX) * 100,
    (a16 / LAB_V2_MAX) * 255 - 128,
    (b16 / LAB_V2_MAX) * 255 - 128,
  ];
}

// ── Inversa de la tabla de corrección ───────────────────────────────────────
// Sistema 3x3 por eliminación de Gauss con pivoteo. null si es singular.
function resolver3(A, b) {
  const M = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    if (Math.abs(M[p][i]) < 1e-12) return null;
    if (p !== i) { const t = M[p]; M[p] = M[i]; M[i] = t; }
    for (let r = i + 1; r < 3; r++) {
      const f = M[r][i] / M[i][i];
      for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c];
    }
  }
  const x = new Float64Array(3);
  for (let i = 2; i >= 0; i--) {
    let s = M[i][3];
    for (let c = i + 1; c < 3; c++) s -= M[i][c] * x[c];
    x[i] = s / M[i][i];
  }
  return x;
}

/**
 * Inversa de la tabla: dado lo que se le manda a la impresora, ¿qué color
 * deseado lo produjo? Es el camino que necesita A2B.
 *
 * Levenberg-Marquardt con jacobiano numérico, el MISMO método que usa el motor
 * de calibración (correccion.js `invertir`). Antes había acá un punto fijo
 * amortiguado y NO alcanzaba: erraba hasta 14 puntos sobre 255 y se quedaba
 * trabado en los bordes (medido con la calibración real).
 *
 * Donde la tabla RECORTA (satura en 0 o 255) la inversa no existe; el método
 * converge al color alcanzable más cercano, que es lo correcto.
 */
export function invertLutColor(lut, dr, dg, db, iters = 60) {
  return invertDesde(lut, dr, dg, db, [dr, dg, db], iters);
}

/**
 * Malla de arranque para la inversión: muestrea la tabla hacia adelante una vez
 * y después, para cada objetivo, arranca del nodo cuyo resultado es el MÁS
 * PARECIDO.
 *
 * POR QUÉ HACE FALTA: con la calibración real, el LM arrancando desde el propio
 * objetivo se quedaba en mínimos locales y erraba hasta 70 puntos sobre 255 en
 * los VERDES. No es culpa del método: en esa zona la tabla de esta impresora
 * NO es inyectiva (se da vuelta; hay colores distintos que terminan casi en el
 * mismo valor). Con un arranque global el residuo baja a fracciones de punto.
 */
export function crearInversor(lut, muestras = 17) {
  const n = muestras;
  const pts = new Float64Array(n * n * n * 3); // resultado de L en cada nodo
  const src = new Float64Array(n * n * n * 3); // el color que lo produjo
  const o = new Float64Array(3);
  let m = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        const r = (i / (n - 1)) * 255;
        const g = (j / (n - 1)) * 255;
        const b = (k / (n - 1)) * 255;
        lut.apply(r, g, b, o);
        pts[m] = o[0]; pts[m + 1] = o[1]; pts[m + 2] = o[2];
        src[m] = r; src[m + 1] = g; src[m + 2] = b;
        m += 3;
      }
    }
  }
  const total = n * n * n;
  return function invertir(dr, dg, db) {
    let mejor = 0;
    let mejorD = Infinity;
    for (let i = 0; i < total; i++) {
      const p = i * 3;
      const e0 = pts[p] - dr;
      const e1 = pts[p + 1] - dg;
      const e2 = pts[p + 2] - db;
      const d = e0 * e0 + e1 * e1 + e2 * e2;
      if (d < mejorD) { mejorD = d; mejor = p; }
    }
    return invertDesde(lut, dr, dg, db, [src[mejor], src[mejor + 1], src[mejor + 2]], 60);
  };
}

function invertDesde(lut, dr, dg, db, inicio, iters) {
  const t = [dr, dg, db];
  const x = [inicio[0], inicio[1], inicio[2]];
  const f0 = new Float64Array(3);
  const f1 = new Float64Array(3);
  const ftmp = new Float64Array(3);
  const J = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  const A = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  const rhs = new Float64Array(3);

  const costo = (p) => {
    lut.apply(p[0], p[1], p[2], ftmp);
    let e = 0;
    for (let i = 0; i < 3; i++) { const d = ftmp[i] - t[i]; e += d * d; }
    return e;
  };

  let e = costo(x);
  let mu = 1e-3;
  for (let it = 0; it < iters && e > 1e-10; it++) {
    lut.apply(x[0], x[1], x[2], f0);
    for (let j = 0; j < 3; j++) {
      let h = 2.0;
      const xp = [x[0], x[1], x[2]];
      if (xp[j] + h > 255) h = -h;
      xp[j] = x[j] + h;
      lut.apply(xp[0], xp[1], xp[2], f1);
      for (let i = 0; i < 3; i++) J[i][j] = (f1[i] - f0[i]) / h;
    }
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        let s = 0;
        for (let i = 0; i < 3; i++) s += J[i][a] * J[i][b];
        A[a][b] = s;
      }
      A[a][a] += mu;
      let sr = 0;
      for (let i = 0; i < 3; i++) sr += J[i][a] * (f0[i] - t[i]);
      rhs[a] = -sr;
    }
    const d = resolver3(A, rhs);
    if (!d) break;
    let norma = Math.hypot(d[0], d[1], d[2]);
    if (norma > 40) { const sc = 40 / norma; d[0] *= sc; d[1] *= sc; d[2] *= sc; norma = 40; }
    const xn = [clamp255(x[0] + d[0]), clamp255(x[1] + d[1]), clamp255(x[2] + d[2])];
    const en = costo(xn);
    if (en < e) {
      x[0] = xn[0]; x[1] = xn[1]; x[2] = xn[2];
      e = en;
      mu = Math.max(1e-8, mu * 0.3);
      if (norma < 1e-3) break;
    } else {
      mu *= 10;
      if (mu > 1e8) break;
    }
  }
  return x;
}

// ── Tipos de etiqueta ICC ───────────────────────────────────────────────────
function tagText(s) {
  const w = new Writer();
  w.sig('text').u32(0).ascii(s).u8(0);
  return w.pad4().toUint8Array();
}

// textDescriptionType (v2): ASCII + hueco Unicode + hueco ScriptCode.
function tagDesc(s) {
  const w = new Writer();
  w.sig('desc').u32(0).u32(s.length + 1).ascii(s).u8(0);
  w.u32(0).u32(0); // código de idioma Unicode + cantidad
  w.u16(0).u8(0).zeros(67); // ScriptCode
  return w.pad4().toUint8Array();
}

function tagXYZ(x, y, z) {
  const w = new Writer();
  w.sig('XYZ ').u32(0).s15f16(x).s15f16(y).s15f16(z);
  return w.pad4().toUint8Array();
}

// lut16Type ('mft2'). La cadena que ejecuta el motor de color es:
//     entrada -> MATRIZ -> curvas de entrada -> CLUT -> curvas de salida
// `clut` va con el PRIMER canal de entrada variando MÁS LENTO:
//     ((i0*g + i1)*g + i2)*outCh + c
// `matrix` es una lista de 9 números (sólo la usa el motor cuando la entrada es
// PCS XYZ; con Lab TIENE que ser la identidad).
// `inCurves`/`outCurves`: arrays de Uint16Array (uno por canal) o null = identidad.
function tagLut16(inCh, outCh, grid, clut, {
  matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1], inCurves = null, outCurves = null,
} = {}) {
  const w = new Writer();
  const nIn = inCurves ? inCurves[0].length : 2;
  const nOut = outCurves ? outCurves[0].length : 2;
  w.sig('mft2').u32(0);
  w.u8(inCh).u8(outCh).u8(grid).u8(0);
  for (const v of matrix) w.s15f16(v);
  w.u16(nIn).u16(nOut);
  for (let i = 0; i < inCh; i++) {
    if (inCurves) { for (const v of inCurves[i]) w.u16(v); } else { w.u16(0); w.u16(0xffff); }
  }
  for (let i = 0; i < clut.length; i++) w.u16(clut[i]);
  for (let i = 0; i < outCh; i++) {
    if (outCurves) { for (const v of outCurves[i]) w.u16(v); } else { w.u16(0); w.u16(0xffff); }
  }
  return w.pad4().toUint8Array();
}

// ── PCS XYZ ─────────────────────────────────────────────────────────────────
// Codificación u1Fixed15: valor = codificado / 32768  => 0 .. 1,99997.
const XYZ_ENC = 32768;
export function xyzToPcs16(x, y, z) {
  const e = (v) => Math.max(0, Math.min(0xffff, Math.round(v * XYZ_ENC)));
  return [e(x), e(y), e(z)];
}

/** sRGB 0..255 -> XYZ D50 (0..1) */
export function srgbToXyzD50(r, g, b) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const M = SRGB_TO_XYZ_D50;
  return [
    M[0][0] * R + M[0][1] * G + M[0][2] * B,
    M[1][0] * R + M[1][1] * G + M[1][2] * B,
    M[2][0] * R + M[2][1] * G + M[2][2] * B,
  ];
}

// Curva de 4096 entradas: luz lineal (0..1) -> sRGB codificado (0..1).
// Es la gamma sRGB. Con 4096 puntos la interpolación lineal del motor de color
// la sigue con un error despreciable (< 1e-4).
function curvaGammaSrgb(n = 4096) {
  const c = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    c[i] = Math.max(0, Math.min(0xffff, Math.round((linearToSrgb(u) / 255) * 0xffff)));
  }
  return c;
}

// ── Construcción de las tablas ──────────────────────────────────────────────
/** A2B: dispositivo RGB -> PCS Lab(D50). Recorre la rejilla del dispositivo. */
function buildA2B(lut, grid) {
  const clut = new Uint16Array(grid * grid * grid * 3);
  let n = 0;
  const invertir = crearInversor(lut, 33);
  for (let i = 0; i < grid; i++) {
    const dr = (i / (grid - 1)) * 255;
    for (let j = 0; j < grid; j++) {
      const dg = (j / (grid - 1)) * 255;
      for (let k = 0; k < grid; k++) {
        const db = (k / (grid - 1)) * 255;
        const c = invertir(dr, dg, db);
        const lab = srgbToLabD50(c[0], c[1], c[2]);
        const p = labToPcs16(lab[0], lab[1], lab[2]);
        clut[n++] = p[0];
        clut[n++] = p[1];
        clut[n++] = p[2];
      }
    }
  }
  return clut;
}

/** B2A: PCS Lab(D50) -> dispositivo RGB. Es el camino que usa Corel al imprimir. */
function buildB2A(lut, grid) {
  const clut = new Uint16Array(grid * grid * grid * 3);
  const o = new Float64Array(3);
  let n = 0;
  for (let i = 0; i < grid; i++) {
    // El nodo i corresponde al valor CODIFICADO i/(g-1)*65535 (no al Lab crudo).
    const L = pcs16ToLab((i / (grid - 1)) * 0xffff, 0, 0)[0];
    for (let j = 0; j < grid; j++) {
      const a = pcs16ToLab(0, (j / (grid - 1)) * 0xffff, 0)[1];
      for (let k = 0; k < grid; k++) {
        const b = pcs16ToLab(0, 0, (k / (grid - 1)) * 0xffff)[2];
        // SIN recortar (ver labD50ToSrgbExt): así la función queda suave y la
        // interpolación del motor de color no se rompe en el borde de la gama.
        // Lut3.apply ya extrapola linealmente fuera de 0..255.
        const s = labD50ToSrgbExt(L, a, b);
        lut.apply(s[0], s[1], s[2], o);
        // El recorte va acá, recién al escribir los 16 bits.
        clut[n++] = Math.round((clamp255(o[0]) / 255) * 0xffff);
        clut[n++] = Math.round((clamp255(o[1]) / 255) * 0xffff);
        clut[n++] = Math.round((clamp255(o[2]) / 255) * 0xffff);
      }
    }
  }
  return clut;
}

/** gamut: 1 canal, 0 = dentro de gama. Los perfiles de salida lo llevan. */
function buildGamut(grid) {
  return new Uint16Array(grid * grid * grid); // todo 0
}

// ── Variante PCS XYZ (la exacta) ────────────────────────────────────────────
// POR QUÉ EXISTE: con PCS Lab el motor de color tiene que reconstruir una
// función muy curva (Lab -> sRGB -> corrección) a través de una rejilla gruesa,
// y el error se va a 8-24 puntos sobre 255 en los colores saturados — medido,
// y NO baja agrandando la rejilla. Con PCS XYZ la cadena queda separable:
//     XYZ --(matriz 3x3 EXACTA)--> luz lineal --(curva 1D)--> sRGB --(CLUT)--> device
// y el CLUT queda indexado EN sRGB, que es justo donde vive la tabla de la
// calibración: se copian sus propios nodos y la interpolación del motor de
// color es la MISMA que hace PrintLayout. Error ~ 0.

/** B2A en XYZ: el CLUT es, literalmente, la tabla de la calibración. */
function buildB2A_XYZ(lut) {
  const S = lut.S;
  const clut = new Uint16Array(S * S * S * 3);
  // Lut3 indexa ((r*S+g)*S+b)*3+c, con r variando más lento: es EXACTAMENTE el
  // orden que pide el CLUT de ICC. Se copia tal cual, sólo cambiando la escala.
  for (let i = 0; i < clut.length; i++) {
    clut[i] = Math.max(0, Math.min(0xffff, Math.round((lut.V[i] / 255) * 0xffff)));
  }
  return clut;
}

// El CLUT de A2B NO guarda el XYZ crudo sino XYZ^(1/2,4) (ver abajo), y esta
// curva de salida lo devuelve a XYZ codificado.
const XYZ_A2B_GAMMA = 2.4;
const XYZ_MAX = 0xffff / XYZ_ENC; // 1,99997: el XYZ más grande que se puede codificar

function curvaSalidaXyz(n = 4096) {
  const c = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    c[i] = Math.max(0, Math.min(0xffff, Math.round(Math.pow(u, XYZ_A2B_GAMMA) * 0xffff)));
  }
  return c;
}

/**
 * A2B en XYZ: dispositivo RGB -> XYZ D50, sobre una rejilla uniforme de device.
 *
 * OJO: el CLUT guarda (XYZ/XYZ_MAX)^(1/2,4), no el XYZ directo. El XYZ es luz
 * LINEAL y la rejilla va en valores de dispositivo (que llevan gamma): guardar
 * el XYZ crudo hacía que la interpolación del motor de color errara feo en los
 * oscuros (medido: 23 puntos sobre 255 en un azul oscuro). Con la potencia
 * inversa el valor guardado queda casi proporcional al del dispositivo, la
 * interpolación es buena, y la curva de SALIDA (curvaSalidaXyz) lo devuelve a
 * XYZ codificado.
 */
function buildA2B_XYZ(lut, grid) {
  const clut = new Uint16Array(grid * grid * grid * 3);
  let n = 0;
  const invertir = crearInversor(lut, 33);
  for (let i = 0; i < grid; i++) {
    const dr = (i / (grid - 1)) * 255;
    for (let j = 0; j < grid; j++) {
      const dg = (j / (grid - 1)) * 255;
      for (let k = 0; k < grid; k++) {
        const db = (k / (grid - 1)) * 255;
        const c = invertir(dr, dg, db);
        const xyz = srgbToXyzD50(c[0], c[1], c[2]);
        for (let ch = 0; ch < 3; ch++) {
          const u = Math.max(0, Math.min(1, xyz[ch] / XYZ_MAX));
          clut[n++] = Math.round(Math.pow(u, 1 / XYZ_A2B_GAMMA) * 0xffff);
        }
      }
    }
  }
  return clut;
}

// ── Perfil completo ─────────────────────────────────────────────────────────
/**
 * Arma el .icc de una calibración guardada.
 *
 * @param {{lut:number[]|Float64Array, lutSize:number}} cal
 * @param {object} opts
 * @param {string} opts.descripcion nombre interno (lo que muestra Corel)
 * @param {string} [opts.copyright]
 * @param {'XYZ'|'Lab'} [opts.pcs='XYZ'] espacio de conexión. 'XYZ' es el EXACTO
 *        (ver buildB2A_XYZ); 'Lab' queda como alternativa por compatibilidad,
 *        pero NO logra la precisión pedida en los colores saturados.
 * @param {number} [opts.gridA2B=33] nodos por eje de A2B (mínimo 17). Más de 33
 *        NO mejora: el techo lo pone el doblez de la tabla (ver abajo).
 * @param {number} [opts.gridB2A=33] nodos por eje de B2A (sólo en modo Lab)
 * @param {number} [opts.xyzMatrixScale=2] escala de la matriz XYZ->RGB lineal.
 *        VERIFICADO contra el motor de color de Windows (mscms): normaliza el
 *        PCS XYZ dividiendo por 65535, no por 32768, así que la matriz va por
 *        2. Con 1 el color sale oscurísimo (medido: 136 de error sobre 255);
 *        con 2, una tabla identidad vuelve EXACTA. No tocar sin re-verificar
 *        con npm run test:color-icc-windows.
 * @param {Date} [opts.fecha]
 * @returns {Uint8Array} bytes del perfil
 */
export function buildIccProfile(cal, {
  descripcion,
  copyright = 'La Recta Imprenta - PrintLayout',
  pcs = 'XYZ',
  gridA2B = 33,
  gridB2A = 33,
  xyzMatrixScale = 2,
  fecha = null,
} = {}) {
  const S = cal?.lutSize || Math.round(Math.cbrt((cal?.lut?.length || 0) / 3));
  if (!(S >= 2) || !cal?.lut || cal.lut.length !== S * S * S * 3) {
    throw new Error('La calibración no tiene una tabla de color válida.');
  }
  const lut = new Lut3(S);
  lut.V.set(cal.lut);
  const esXYZ = pcs === 'XYZ';

  let a2b;
  let b2a;
  if (esXYZ) {
    const gamma = curvaGammaSrgb();
    const M = XYZ_D50_TO_SRGB;
    const matriz = [
      M[0][0] * xyzMatrixScale, M[0][1] * xyzMatrixScale, M[0][2] * xyzMatrixScale,
      M[1][0] * xyzMatrixScale, M[1][1] * xyzMatrixScale, M[1][2] * xyzMatrixScale,
      M[2][0] * xyzMatrixScale, M[2][1] * xyzMatrixScale, M[2][2] * xyzMatrixScale,
    ];
    b2a = tagLut16(3, 3, S, buildB2A_XYZ(lut), {
      matrix: matriz, inCurves: [gamma, gamma, gamma],
    });
    const salidaXyz = curvaSalidaXyz();
    a2b = tagLut16(3, 3, gridA2B, buildA2B_XYZ(lut, gridA2B), {
      outCurves: [salidaXyz, salidaXyz, salidaXyz],
    });
  } else {
    b2a = tagLut16(3, 3, gridB2A, buildB2A(lut, gridB2A));
    a2b = tagLut16(3, 3, gridA2B, buildA2B(lut, gridA2B));
  }
  const gamt = tagLut16(3, 1, gridA2B, buildGamut(gridA2B));

  // Varias etiquetas pueden APUNTAR AL MISMO bloque (lo permite ICC y es lo
  // habitual): así el perfil pesa ~250 KB en vez de ~750 KB.
  const blobs = [
    { data: tagDesc(descripcion), sigs: ['desc'] },
    { data: tagText(copyright), sigs: ['cprt'] },
    { data: tagXYZ(WHITE_D50[0], WHITE_D50[1], WHITE_D50[2]), sigs: ['wtpt'] },
    { data: a2b, sigs: ['A2B0', 'A2B1', 'A2B2'] },
    { data: b2a, sigs: ['B2A0', 'B2A1', 'B2A2'] },
    { data: gamt, sigs: ['gamt'] },
  ];

  const tagCount = blobs.reduce((s, b) => s + b.sigs.length, 0);
  let off = 128 + 4 + tagCount * 12;
  off += (4 - (off % 4)) % 4;
  const entries = [];
  for (const b of blobs) {
    for (const s of b.sigs) entries.push({ sig: s, offset: off, size: b.data.length });
    off += b.data.length;
    off += (4 - (off % 4)) % 4;
  }

  const w = new Writer();
  // ── cabecera (128 bytes) ──
  w.u32(off); // tamaño total
  w.u32(0); // CMM preferido: ninguno
  w.u32(0x02400000); // versión 2.4.0
  w.sig('prtr'); // clase: impresora
  w.sig('RGB '); // espacio de datos
  w.sig(esXYZ ? 'XYZ ' : 'Lab '); // PCS
  const d = fecha || new Date(Date.UTC(2026, 0, 1));
  w.u16(d.getUTCFullYear()).u16(d.getUTCMonth() + 1).u16(d.getUTCDate());
  w.u16(d.getUTCHours()).u16(d.getUTCMinutes()).u16(d.getUTCSeconds());
  w.sig('acsp');
  w.sig('MSFT');
  w.u32(0).u32(0).u32(0); // flags, fabricante, modelo
  w.u32(0).u32(0); // atributos del dispositivo
  w.u32(1); // intención por defecto: colorimétrico relativo
  w.s15f16(0.9642).s15f16(1.0).s15f16(0.8249); // iluminante del PCS (D50)
  w.u32(0); // creador
  w.zeros(16); // id del perfil
  w.zeros(28); // reservado
  // ── tabla de etiquetas ──
  w.u32(tagCount);
  for (const e of entries) w.sig(e.sig).u32(e.offset).u32(e.size);
  w.pad4();
  // ── datos ──
  for (const b of blobs) {
    w.pad4();
    w.push(b.data);
  }
  w.pad4();
  return w.toUint8Array();
}

/** Nombre de archivo sugerido (sin caracteres que Windows no acepta). */
export function nombreArchivoPerfil(cal, fecha = null) {
  const ip = cal?.correctPrinter?.ip || 'impresora';
  const ultimo = String(ip).split('.').pop();
  const papel = cal?.paperName ? ` ${cal.paperName}` : '';
  const d = fecha || new Date();
  const f = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // El nombre sale SOLO de datos que viajan con la calibración (IP, papel, fecha):
  // así todas las PC que bajan la misma calibración compartida escriben el mismo
  // archivo. Por eso NO se usa el nombre de la cola, que es propio de cada PC.
  return `Impresora .${ultimo} corregida (PrintLayout)${papel} ${f}.icc`
    .replace(/[\\/:*?"<>|]/g, '-');
}

/** Descripción interna (lo que Corel muestra en su lista de perfiles). */
export function descripcionPerfil(cal, fecha = null) {
  return nombreArchivoPerfil(cal, fecha).replace(/\.icc$/, '');
}

// ── LÍMITE CONOCIDO DEL A2B (no es un bug del generador) ────────────────────
// El camino que usa Corel PARA IMPRIMIR es B2A, y ese es exacto (medido: 0,02
// sobre 255 en los 343 colores de la carta).
//
// El A2B (dispositivo -> PCS), que se usa para previsualizar/simular, NO puede
// ser exacto con cualquier calibración: si la tabla de corrección se DOBLA
// (dos colores distintos terminan en el mismo valor enviado), ahí no existe
// inversa. Con la calibración real de la Ricoh .198 eso pasa en la zona de los
// VERDES —la misma donde la corrección llega al tope y recorta— y el ida y
// vuelta queda con ~7 puntos sobre 255 en unos 10 de 199 colores alcanzables.
// Agrandar la rejilla NO lo arregla (probado 17/25/33/41/49/65: se estanca en
// ~7) porque los nodos vecinos caen en ramas distintas del doblez.
