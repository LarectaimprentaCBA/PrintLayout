// Color y tablas 3D — port fiel de las clases ColorLab / GrillaMedida / Tri / Lut3
// de motor/Correccion.cs. Lab sRGB D65, interpolación trilineal, LUT 3D (.cube).

import { Levels, N, Count, patchIndices } from './layout.js';

// ── Lab (sRGB D65) ───────────────────────────────────────────────────────────
function lin(c) {
  c = Math.max(0.0, Math.min(255.0, c)) / 255.0;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function fLab(t) {
  return t > 0.008856 ? Math.pow(t, 1.0 / 3.0) : 7.787 * t + 16.0 / 116.0;
}

// Escribe [L,a,b] en `lab` (array de 3).
export function rgbToLab(r, g, b, lab) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = (0.2126 * R + 0.7152 * G + 0.0722 * B);
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
  lab[0] = 116.0 * fy - 16.0;
  lab[1] = 500.0 * (fx - fy);
  lab[2] = 200.0 * (fy - fz);
  return lab;
}

export function deltaE(a, b) {
  const d0 = a[0] - b[0], d1 = a[1] - b[1], d2 = a[2] - b[2];
  return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
}

// ── Interpolación trilineal sobre una grilla V[r][g][b][canal] aplanada ───────
// V es un Float64Array con índice ((r*dim + g)*dim + b)*3 + c.
export function triInterp(V, dim, kr, kg, kb, tr, tg, tb, c) {
  const at = (r, g, b) => V[((r * dim + g) * dim + b) * 3 + c];
  const c000 = at(kr, kg, kb), c100 = at(kr + 1, kg, kb);
  const c010 = at(kr, kg + 1, kb), c110 = at(kr + 1, kg + 1, kb);
  const c001 = at(kr, kg, kb + 1), c101 = at(kr + 1, kg, kb + 1);
  const c011 = at(kr, kg + 1, kb + 1), c111 = at(kr + 1, kg + 1, kb + 1);
  const c00 = c000 + (c100 - c000) * tr, c10 = c010 + (c110 - c010) * tr;
  const c01 = c001 + (c101 - c001) * tr, c11 = c011 + (c111 - c011) * tr;
  const c0 = c00 + (c10 - c00) * tg, c1 = c01 + (c11 - c01) * tg;
  return c0 + (c1 - c0) * tb;
}

// ── GrillaMedida: colores medidos (en Lab) sobre la grilla 7×7×7, interpolables ─
export class GrillaMedida {
  constructor() {
    this.V = new Float64Array(N * N * N * 3);
  }

  static desdeMedicion(m) {
    const grid = new GrillaMedida();
    const lab = new Float64Array(3);
    for (let i = 0; i < Count; i++) {
      const [ri, gi, bi] = patchIndices(i);
      rgbToLab(m.rgb[i * 3 + 0], m.rgb[i * 3 + 1], m.rgb[i * 3 + 2], lab);
      const base = ((ri * N + gi) * N + bi) * 3;
      grid.V[base + 0] = lab[0];
      grid.V[base + 1] = lab[1];
      grid.V[base + 2] = lab[2];
    }
    return grid;
  }

  // Encuentra el segmento k y la fracción t para x sobre los niveles NO uniformes.
  static _segmento(x) {
    const L = Levels;
    if (x <= L[0]) return [0, 0];
    if (x >= L[L.length - 1]) return [L.length - 2, 1];
    let k = 0;
    while (k < L.length - 2 && x > L[k + 1]) k++;
    const t = (x - L[k]) / (L[k + 1] - L[k]);
    return [k, t];
  }

  // Escribe [L,a,b] interpolado en `o`.
  at(r, g, b, o) {
    const [kr, tr] = GrillaMedida._segmento(r);
    const [kg, tg] = GrillaMedida._segmento(g);
    const [kb, tb] = GrillaMedida._segmento(b);
    for (let c = 0; c < 3; c++) o[c] = triInterp(this.V, N, kr, kg, kb, tr, tg, tb, c);
    return o;
  }
}

// ── Lut3: LUT 3D en 0..255 (r,g,b,canal), con lectura/escritura .cube ─────────
export class Lut3 {
  constructor(s) {
    this.S = s;
    this.V = new Float64Array(s * s * s * 3);
  }

  nodo(k) { return (255.0 * k) / (this.S - 1); }

  _base(r, g, b) { return ((r * this.S + g) * this.S + b) * 3; }

  set(r, g, b, v0, v1, v2) {
    const base = this._base(r, g, b);
    this.V[base] = v0; this.V[base + 1] = v1; this.V[base + 2] = v2;
  }

  // Aplica la tabla a un color 0..255; escribe el resultado en `o`.
  apply(r, g, b, o) {
    const S = this.S;
    const fr = (r / 255.0) * (S - 1), fg = (g / 255.0) * (S - 1), fb = (b / 255.0) * (S - 1);
    const kr = Math.max(0, Math.min(S - 2, Math.trunc(fr)));
    const kg = Math.max(0, Math.min(S - 2, Math.trunc(fg)));
    const kb = Math.max(0, Math.min(S - 2, Math.trunc(fb)));
    const tr = fr - kr, tg = fg - kg, tb = fb - kb;
    for (let c = 0; c < 3; c++) o[c] = triInterp(this.V, S, kr, kg, kb, tr, tg, tb, c);
    return o;
  }

  // Serializa a texto .cube estándar (orden r rápido, luego g, luego b).
  writeCube(titulo) {
    const S = this.S;
    const f6 = (n) => (n / 255.0).toFixed(6);
    const lines = [];
    lines.push('TITLE "' + titulo + '"');
    lines.push('LUT_3D_SIZE ' + S);
    lines.push('DOMAIN_MIN 0.0 0.0 0.0');
    lines.push('DOMAIN_MAX 1.0 1.0 1.0');
    for (let b = 0; b < S; b++)
      for (let g = 0; g < S; g++)
        for (let r = 0; r < S; r++) {
          const base = this._base(r, g, b);
          lines.push(f6(this.V[base]) + ' ' + f6(this.V[base + 1]) + ' ' + f6(this.V[base + 2]));
        }
    return lines.join('\n') + '\n';
  }

  static readCube(text) {
    let s = 0;
    const vals = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.length === 0 || line.startsWith('#')) continue;
      if (line.startsWith('LUT_3D_SIZE')) { s = parseInt(line.substring(11).trim(), 10); continue; }
      if (/[A-Za-z]/.test(line[0])) continue;
      const p = line.split(/[ \t]+/).filter((x) => x.length > 0);
      if (p.length >= 3) vals.push([parseFloat(p[0]), parseFloat(p[1]), parseFloat(p[2])]);
    }
    if (s < 2 || vals.length !== s * s * s) throw new Error('Archivo .cube inválido');
    const lut = new Lut3(s);
    let n = 0;
    for (let b = 0; b < s; b++)
      for (let g = 0; g < s; g++)
        for (let r = 0; r < s; r++) {
          const v = vals[n++];
          lut.set(r, g, b, v[0] * 255.0, v[1] * 255.0, v[2] * 255.0);
        }
    return lut;
  }
}
