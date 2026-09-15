// Cálculo de la corrección — port fiel de la clase Correccion de motor/Correccion.cs.
// Para cada color, busca qué mandarle a la impresora pálida para que salga como en la
// de referencia (inversión Gauss-Newton amortiguada) → LUT 3D + informe con números.

import { Count, patchColor } from './layout.js';
import { GrillaMedida, Lut3, rgbToLab, deltaE } from './colorMath.js';

const LAMBDA = 0.0004;      // cuánto "cuesta" alejarse del color original
const CROMA_FUERTE = 50.0;  // desde acá un color cuenta como "fuerte / saturado"

function croma(lab) { return Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]); }
function clamp(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

// Formato .NET Framework: redondeo half-away-from-zero, coma decimal.
function fmt(n, dec) {
  const p = Math.pow(10, dec);
  const r = Math.sign(n) * Math.round(Math.abs(n) * p) / p;
  return r.toFixed(dec).replace('.', ',');
}
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function promedio(v) {
  if (v.length === 0) return 0;
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

// buena/palida = objetos Medicion { rgb: Float64Array(Count*3), log }
export function calcular(buena, palida, size, labels = { buena: '.127', palida: '.198' }) {
  const G = GrillaMedida.desdeMedicion(buena);
  const B = GrillaMedida.desdeMedicion(palida);
  const lut = new Lut3(size);
  const t = new Float64Array(3);
  const x = new Float64Array(3);
  const c = new Float64Array(3);
  for (let ir = 0; ir < size; ir++)
    for (let ig = 0; ig < size; ig++)
      for (let ib = 0; ib < size; ib++) {
        c[0] = lut.nodo(ir); c[1] = lut.nodo(ig); c[2] = lut.nodo(ib);
        G.at(c[0], c[1], c[2], t);
        invertir(B, t, c, x);
        lut.set(ir, ig, ib, x[0], x[1], x[2]);
      }
  suavizar(lut);

  const informe = armarInforme(buena, palida, G, B, lut, labels);
  return { lut, informe: informe.texto, csv: informe.csv, stats: informe.stats };
}

function costo(B, t, c, x, tmp) {
  B.at(x[0], x[1], x[2], tmp);
  let e = 0;
  for (let k = 0; k < 3; k++) { const d = tmp[k] - t[k]; e += d * d; }
  for (let k = 0; k < 3; k++) { const d = x[k] - c[k]; e += LAMBDA * d * d; }
  return e;
}

// Busca el color x a mandarle a la pálida para que salga lo más parecido a t.
function invertir(B, t, c, x) {
  x[0] = c[0]; x[1] = c[1]; x[2] = c[2];
  const f0 = new Float64Array(3);
  const f1 = new Float64Array(3);
  const J = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  const xp = new Float64Array(3);
  const tmp = new Float64Array(3);
  const A = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  const rhs = new Float64Array(3);
  let e = costo(B, t, c, x, tmp);
  let mu = 1e-2;
  for (let it = 0; it < 40; it++) {
    B.at(x[0], x[1], x[2], f0);
    for (let j = 0; j < 3; j++) {
      let h = 3.0;
      xp[0] = x[0]; xp[1] = x[1]; xp[2] = x[2];
      if (x[j] + h > 255) h = -h;
      xp[j] = x[j] + h;
      B.at(xp[0], xp[1], xp[2], f1);
      for (let i = 0; i < 3; i++) J[i][j] = (f1[i] - f0[i]) / h;
    }
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        let s = 0;
        for (let i = 0; i < 3; i++) s += J[i][a] * J[i][b];
        A[a][b] = s;
      }
      A[a][a] += LAMBDA + mu;
      let sr = 0;
      for (let i = 0; i < 3; i++) sr += J[i][a] * (f0[i] - t[i]);
      rhs[a] = -(sr + LAMBDA * (x[a] - c[a]));
    }
    const d = resolver3(A, rhs);
    if (!d) break;
    let norma = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    if (norma > 40) { const sc = 40 / norma; d[0] *= sc; d[1] *= sc; d[2] *= sc; norma = 40; }
    xp[0] = clamp(x[0] + d[0]); xp[1] = clamp(x[1] + d[1]); xp[2] = clamp(x[2] + d[2]);
    const en = costo(B, t, c, xp, tmp);
    if (en < e) {
      x[0] = xp[0]; x[1] = xp[1]; x[2] = xp[2];
      e = en;
      mu = Math.max(1e-6, mu * 0.3);
      if (norma < 0.05) break;
    } else {
      mu *= 10;
      if (mu > 1e6) break;
    }
  }
}

function resolver3(A, b) {
  const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
            - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
            + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  if (Math.abs(det) < 1e-15) return null;
  const r = new Float64Array(3);
  for (let col = 0; col < 3; col++) {
    const M = [Float64Array.from(A[0]), Float64Array.from(A[1]), Float64Array.from(A[2])];
    for (let i = 0; i < 3; i++) M[i][col] = b[i];
    const dc = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
             - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
             + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    r[col] = dc / det;
  }
  return r;
}

// Suaviza el desplazamiento (corrección - original) para no meter saltos por ruido.
function suavizar(lut) {
  const S = lut.S;
  const D = new Float64Array(S * S * S * 3);
  const idx = (r, g, b, c) => ((r * S + g) * S + b) * 3 + c;
  for (let r = 0; r < S; r++)
    for (let g = 0; g < S; g++)
      for (let b = 0; b < S; b++) {
        D[idx(r, g, b, 0)] = lut.V[idx(r, g, b, 0)] - lut.nodo(r);
        D[idx(r, g, b, 1)] = lut.V[idx(r, g, b, 1)] - lut.nodo(g);
        D[idx(r, g, b, 2)] = lut.V[idx(r, g, b, 2)] - lut.nodo(b);
      }
  for (let r = 0; r < S; r++)
    for (let g = 0; g < S; g++)
      for (let b = 0; b < S; b++)
        for (let c = 0; c < 3; c++) {
          let s = 4 * D[idx(r, g, b, c)], w = 4;
          if (r > 0) { s += D[idx(r - 1, g, b, c)]; w++; }
          if (r < S - 1) { s += D[idx(r + 1, g, b, c)]; w++; }
          if (g > 0) { s += D[idx(r, g - 1, b, c)]; w++; }
          if (g < S - 1) { s += D[idx(r, g + 1, b, c)]; w++; }
          if (b > 0) { s += D[idx(r, g, b - 1, c)]; w++; }
          if (b < S - 1) { s += D[idx(r, g, b + 1, c)]; w++; }
          const nodo = c === 0 ? lut.nodo(r) : (c === 1 ? lut.nodo(g) : lut.nodo(b));
          lut.V[idx(r, g, b, c)] = clamp(nodo + s / w);
        }
}

function resumen(lines, titulo, v) {
  const o = Array.from(v).sort((a, b) => a - b);
  let suma = 0, menos2 = 0, menos5 = 0;
  for (const x of o) { suma += x; if (x < 2) menos2++; if (x < 5) menos5++; }
  const n = o.length;
  lines.push('  ' + titulo);
  lines.push('    promedio ' + fmt(suma / n, 1) + '   mediana ' + fmt(o[Math.trunc(n / 2)], 1)
    + '   peor 10% desde ' + fmt(o[Math.trunc(n * 0.9)], 1) + '   máximo ' + fmt(o[n - 1], 1));
  lines.push('    colores con diferencia menor a 2: ' + menos2 + ' de ' + n + ' (' + Math.trunc((100 * menos2) / n) + '%)'
    + '   menor a 5: ' + menos5 + ' (' + Math.trunc((100 * menos5) / n) + '%)');
}

function armarInforme(buena, palida, G, B, lut, labels) {
  const antes = [], despues = [];
  const claroA = [], claroD = [], medioA = [], medioD = [], oscuroA = [], oscuroD = [];
  const fuerteA = [], fuerteD = [], suaveA = [], suaveD = [];
  const grises = [];
  const peores = [];
  const csv = [];
  csv.push('parche;R;G;B;buena_R;buena_G;buena_B;palida_R;palida_G;palida_B;dif_antes;dif_despues_prevista;se_envia_R;se_envia_G;se_envia_B');
  const cfmt = (n, d) => fmt(n, d); // el CSV del kit usa ci (punto); acá no se compara texto

  const labG = new Float64Array(3), labB = new Float64Array(3), labP = new Float64Array(3), o = new Float64Array(3);
  let sumaLBuena = 0, sumaLPalida = 0;
  for (let i = 0; i < Count; i++) {
    const [r, g, b] = patchColor(i);
    rgbToLab(buena.rgb[i * 3], buena.rgb[i * 3 + 1], buena.rgb[i * 3 + 2], labG);
    rgbToLab(palida.rgb[i * 3], palida.rgb[i * 3 + 1], palida.rgb[i * 3 + 2], labB);
    const dA = deltaE(labG, labB);
    sumaLBuena += labG[0];
    sumaLPalida += labB[0];
    lut.apply(r, g, b, o);
    B.at(o[0], o[1], o[2], labP);
    const dD = deltaE(labG, labP);
    antes.push(dA);
    despues.push(dD);
    if (croma(labG) >= CROMA_FUERTE) { fuerteA.push(dA); fuerteD.push(dD); } else { suaveA.push(dA); suaveD.push(dD); }
    if (labG[0] >= 70) { claroA.push(dA); claroD.push(dD); }
    else if (labG[0] >= 35) { medioA.push(dA); medioD.push(dD); }
    else { oscuroA.push(dA); oscuroD.push(dD); }
    if (r === g && g === b)
      grises.push('    gris ' + padL(r, 3) + ':  luminosidad buena ' + padL(fmt(labG[0], 1), 5)
        + '   pálida ' + padL(fmt(labB[0], 1), 5) + '   diferencia antes ' + padL(fmt(dA, 1), 4)
        + '   después ' + padL(fmt(dD, 1), 4));
    peores.push({ key: dD, txt: '    RGB(' + r + ',' + g + ',' + b + ')  antes ' + fmt(dA, 1) + '  después ' + fmt(dD, 1) });
    csv.push(i + ';' + r + ';' + g + ';' + b + ';'
      + cfmt(buena.rgb[i * 3], 1) + ';' + cfmt(buena.rgb[i * 3 + 1], 1) + ';' + cfmt(buena.rgb[i * 3 + 2], 1) + ';'
      + cfmt(palida.rgb[i * 3], 1) + ';' + cfmt(palida.rgb[i * 3 + 1], 1) + ';' + cfmt(palida.rgb[i * 3 + 2], 1) + ';'
      + cfmt(dA, 2) + ';' + cfmt(dD, 2) + ';'
      + cfmt(o[0], 1) + ';' + cfmt(o[1], 1) + ';' + cfmt(o[2], 1));
  }
  peores.sort((p, q) => q.key - p.key);

  const promA = promedio(antes), promD = promedio(despues);
  const sd = Array.from(despues).sort((a, b) => a - b);
  const p90D = sd[Math.trunc(sd.length * 0.9)];
  let fuera = 0;
  for (const v of despues) if (v >= 5) fuera++;

  const L = [];
  const lb = labels.buena, lp = labels.palida;
  L.push('CORRECCIÓN DE COLOR — RICOH ' + lp + ' (pálida) para que se parezca a la ' + lb + ' (buena)');
  L.push('=================================================================================');
  L.push('');
  L.push('CÓMO LEER LOS NÚMEROS (diferencia de color medida con el escáner):');
  L.push('  menos de 2  -> a simple vista, iguales');
  L.push('  2 a 5       -> se nota si ponés las dos hojas una al lado de la otra');
  L.push('  más de 5    -> se nota claramente');
  L.push('');
  const lumBuena = sumaLBuena / Count, lumPalida = sumaLPalida / Count;
  if (lumPalida < lumBuena - 0.5) {
    L.push('!!!!! ATENCIÓN: la hoja marcada como ' + lp + ' salió MÁS OSCURA que la ' + lb + '.');
    L.push('      ¿Están cambiados los nombres de los escaneos? Cada hoja dice arriba en qué Ricoh se imprimió.');
    L.push('      Si están cambiados, NO uses esta corrección: arreglá los nombres y volvé a analizar.');
    L.push('');
  }
  L.push('LUMINOSIDAD PROMEDIO DE LOS 343 COLORES (más alto = más claro):');
  L.push('  ' + lb + ' (buena): ' + fmt(lumBuena, 1) + '    ' + lp + ' (pálida): ' + fmt(lumPalida, 1)
    + '    -> la ' + lp + ' sale ' + fmt(Math.abs(lumPalida - lumBuena), 1) + ' puntos ' + (lumPalida >= lumBuena ? 'más clara' : 'más oscura'));
  L.push('');
  L.push('VEREDICTO PREVISTO:');
  if (promD < 2.5 && p90D < 5)
    L.push('  La corrección debería dejar la ' + lp + ' prácticamente igual a la ' + lb + ' en casi todos los colores.');
  else if (promD < promA * 0.5)
    L.push('  Mejora clara, pero hay colores que la ' + lp + ' no llega a sacar (ver la lista de abajo).');
  else
    L.push('  La mejora prevista es chica: la ' + lp + ' casi no tiene margen para compensar.');
  L.push('  Colores que igual van a quedar con diferencia de 5 o más: ' + fuera + ' de ' + Count + '.');
  L.push('');
  L.push('OJO: esto es lo PREVISTO según el escaneo. La prueba real es imprimir la carta');
  L.push('corregida en la ' + lp + ', escanearla y correr el paso 4 (medir-corregida).');
  L.push('');
  L.push('RESUMEN (343 colores de la carta)');
  resumen(L, 'Hoy, ' + lb + ' contra ' + lp + ' sin corregir:', antes);
  resumen(L, 'Previsto con la corrección:', despues);
  L.push('');
  L.push('POR ZONA (promedio antes -> después)');
  L.push('  claros   (' + claroA.length + ' colores): ' + fmt(promedio(claroA), 1) + ' -> ' + fmt(promedio(claroD), 1));
  L.push('  medios   (' + medioA.length + ' colores): ' + fmt(promedio(medioA), 1) + ' -> ' + fmt(promedio(medioD), 1));
  L.push('  oscuros  (' + oscuroA.length + ' colores): ' + fmt(promedio(oscuroA), 1) + ' -> ' + fmt(promedio(oscuroD), 1));
  L.push('');
  L.push('POR TIPO DE COLOR (promedio antes -> después)');
  L.push('  fuertes / saturados  (' + fuerteA.length + ' colores): ' + fmt(promedio(fuerteA), 1) + ' -> ' + fmt(promedio(fuerteD), 1));
  L.push('  combinados / suaves  (' + suaveA.length + ' colores): ' + fmt(promedio(suaveA), 1) + ' -> ' + fmt(promedio(suaveD), 1));
  L.push('');
  L.push('GRISES (de negro a blanco)');
  for (const line of grises) L.push(line);
  L.push('');
  L.push('LOS 12 COLORES QUE PEOR QUEDAN DESPUÉS DE CORREGIR');
  for (let k = 0; k < 12 && k < peores.length; k++) L.push(peores[k].txt);
  L.push('');
  L.push('LECTURA DE LOS ESCANEOS');
  L.push(buena.log.replace(/\n$/, ''));
  L.push(palida.log.replace(/\n$/, ''));

  const stats = {
    lumBuena, lumPalida, promA, promD, p90D, fuera,
    antesProm: promedio(antes), despuesProm: promedio(despues),
  };
  return { texto: L.join('\n') + '\n', csv: csv.join('\n') + '\n', stats };
}

// Paso 4: compara la carta CORREGIDA impresa en la pálida contra la buena, parche a parche.
export function informeCorregida(buena, corregida, palidaSinCorregir, labels = { buena: '.127', palida: '.198' }) {
  const antes = [], despues = [];
  const labG = new Float64Array(3), labC = new Float64Array(3), labB = new Float64Array(3);
  const fuerteA = [], fuerteD = [], suaveA = [], suaveD = [];
  for (let i = 0; i < Count; i++) {
    rgbToLab(buena.rgb[i * 3], buena.rgb[i * 3 + 1], buena.rgb[i * 3 + 2], labG);
    rgbToLab(corregida.rgb[i * 3], corregida.rgb[i * 3 + 1], corregida.rgb[i * 3 + 2], labC);
    const dC = deltaE(labG, labC);
    despues.push(dC);
    const fuerte = croma(labG) >= CROMA_FUERTE;
    if (fuerte) fuerteD.push(dC); else suaveD.push(dC);
    if (palidaSinCorregir) {
      rgbToLab(palidaSinCorregir.rgb[i * 3], palidaSinCorregir.rgb[i * 3 + 1], palidaSinCorregir.rgb[i * 3 + 2], labB);
      const dB = deltaE(labG, labB);
      antes.push(dB);
      if (fuerte) fuerteA.push(dB); else suaveA.push(dB);
    }
  }
  const L = [];
  const lb = labels.buena, lp = labels.palida;
  L.push('RESULTADO REAL — carta corregida impresa en la ' + lp + ', comparada con la ' + lb);
  L.push('==========================================================================');
  L.push('  menos de 2 -> iguales a simple vista;  2 a 5 -> se nota lado a lado;  más de 5 -> se nota claramente');
  L.push('');
  if (antes.length > 0) resumen(L, 'Antes (sin corregir):', antes);
  resumen(L, 'Real con la corrección:', despues);
  L.push('');
  const hayAntes = antes.length > 0;
  L.push('POR TIPO DE COLOR (promedio ' + (hayAntes ? 'antes -> real' : 'real') + ')');
  L.push('  fuertes / saturados  (' + fuerteD.length + ' colores): ' + (hayAntes ? fmt(promedio(fuerteA), 1) + ' -> ' : '') + fmt(promedio(fuerteD), 1));
  L.push('  combinados / suaves  (' + suaveD.length + ' colores): ' + (hayAntes ? fmt(promedio(suaveA), 1) + ' -> ' : '') + fmt(promedio(suaveD), 1));
  L.push('');
  L.push('LECTURA DE LOS ESCANEOS');
  L.push(buena.log.replace(/\n$/, ''));
  L.push(corregida.log.replace(/\n$/, ''));
  if (palidaSinCorregir) L.push(palidaSinCorregir.log.replace(/\n$/, ''));

  const stats = { despuesProm: promedio(despues), antesProm: antes.length ? promedio(antes) : null };
  return { texto: L.join('\n') + '\n', stats };
}
