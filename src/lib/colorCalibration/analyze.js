// Análisis de escaneos en el renderer: decodifica el archivo a píxeles RGBA + DPI, mide
// la carta (con lectura del código), empareja por rol y calcula la corrección.
import { medir } from './reader.js';
import { calcular, informeCorregida } from './correccion.js';
import { pairByCode } from './code.js';
import { parseDpi } from './imageMeta.js';
import { LUT_SIZE } from './index.js';
import { Lut3 } from './colorMath.js';

// File/Blob → { px:{W,H,data(RGBA)}, dpi|null }
export async function fileToPixels(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dpi = parseDpi(buf);
  const bitmap = await createImageBitmap(new Blob([buf]), { colorSpaceConversion: 'default' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close && bitmap.close();
  return { px: { W: bitmap.width, H: bitmap.height, data: img.data }, dpi };
}

export async function measureScan(file, nombre, leerCodigo = true) {
  const { px, dpi } = await fileToPixels(file);
  const m = medir(px, nombre, dpi, { leerCodigo });
  m._fileName = file.name;
  return m;
}

// Analiza dos escaneos y calcula la corrección. Empareja por el CÓDIGO (no por el nombre
// del archivo). Lanza con mensaje claro si falta el código o no son de la misma sesión.
export async function analyzePair(fileA, fileB) {
  const a = await measureScan(fileA, 'escaneo A');
  const b = await measureScan(fileB, 'escaneo B');
  if (!a.code || !b.code) {
    throw new Error('No pude leer el código de una de las cartas. Asegurate de escanear las cartas que imprimió esta app (con el código en la banda de abajo), la hoja entera y a 300 dpi.');
  }
  let pair;
  try {
    pair = pairByCode(a, b);
  } catch (e) {
    if (e.message === 'CODE_SESSION_MISMATCH') throw new Error('Las dos cartas son de calibraciones distintas. Escaneá las DOS cartas de la MISMA sesión (se imprimen juntas).');
    if (e.message === 'CODE_ROLE_DUP') throw new Error('Cargaste dos veces la misma carta (las dos son de la misma impresora). Necesito la de referencia y la de la impresora a corregir.');
    throw e;
  }
  const res = calcular(pair.buena, pair.palida, LUT_SIZE);
  return {
    sessionId: a.code.sessionId,
    lut: Array.from(res.lut.V),
    lutSize: LUT_SIZE,
    informe: res.informe,
    stats: res.stats,
    buenaFile: pair.buena._fileName,
    palidaFile: pair.palida._fileName,
  };
}

// ── Importar una calibración existente (.cube) ───────────────────────────────
const numRe = (re, t) => { const m = t && t.match(re); return m ? parseFloat(m[1].replace(',', '.')) : null; };

// Lee y VALIDA un .cube. Lanza con mensaje claro si es inválido. Devuelve un Lut3.
export function parseCube(text) {
  let lut;
  try {
    lut = Lut3.readCube(text);
  } catch (e) {
    throw new Error('El archivo .cube no es válido (' + e.message + '). ¿Es un .cube de verdad?');
  }
  for (let i = 0; i < lut.V.length; i++) {
    const v = lut.V[i]; // ya viene ×255
    if (!Number.isFinite(v) || v < -0.001 || v > 255.001) throw new Error('El .cube tiene valores fuera de rango (0 a 1) o que no son números.');
  }
  return lut;
}

// Extrae de informe.txt: diferencia antes (promedio), previsto (promedio y máximo) y
// cuántos colores quedan con diferencia ≥5. Los que no encuentre quedan en null.
export function parseInformePrevisto(text) {
  const antesBlock = (text.split('sin corregir:')[1] || '').split('Previsto')[0];
  const prevBlock = (text.split('Previsto con la corrección:')[1] || '');
  return {
    antesProm: numRe(/promedio ([\d,]+)/, antesBlock),
    previstoProm: numRe(/promedio ([\d,]+)/, prevBlock),
    previstoMax: numRe(/máximo ([\d,]+)/, prevBlock),
    fuera5: numRe(/diferencia de 5 o más: (\d+)/, text),
  };
}

// Extrae de informe-corregida.txt el promedio REAL medido.
export function parseInformeReal(text) {
  const realBlock = (text.split('Real con la corrección:')[1] || '');
  return { realProm: numRe(/promedio ([\d,]+)/, realBlock) };
}

// Paso 4 (opcional): mide la carta corregida contra la de referencia.
export async function analyzeCorrected(fileReferencia, fileCorregida) {
  const ref = await measureScan(fileReferencia, 'referencia');
  const cor = await measureScan(fileCorregida, 'corregida');
  if (!ref.code || !cor.code) throw new Error('No pude leer el código de una de las cartas.');
  let pair;
  try { pair = pairByCode(ref, cor); }
  catch (e) {
    if (e.message === 'CODE_ROLE_DUP') throw new Error('Las dos cartas parecen de la misma impresora: cargá la de REFERENCIA y la CORREGIDA.');
    if (e.message === 'CODE_SESSION_MISMATCH') throw new Error('Las cartas son de sesiones distintas.');
    throw e;
  }
  const res = informeCorregida(pair.buena, pair.palida, null);
  return { informe: res.texto, stats: res.stats };
}
