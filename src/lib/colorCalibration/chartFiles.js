// Guarda la carta de 343 parches como archivos, para abrirla e imprimirla
// desde AFUERA de PrintLayout (Corel, o cualquier programa).
//
// Son las MISMAS cartas que imprime el asistente (mismo dibujo, mismo código
// legible por máquina), así que los escaneos sirven igual para "Medir
// resultado" y para el asistente.
//
// Se guardan en PNG (240 dpi, lo que ya genera chart.js) y en PDF A4 a TAMAÑO
// REAL. El PDF es el que conviene mandar a imprimir: el PNG, según cómo lo
// abra cada programa, puede salir escalado y ahí los parches ya no caen donde
// el lector los espera.

import { PDFDocument } from 'pdf-lib';
import { renderChartToDataURL } from './chart.js';
import { PageWmm, PageHmm } from './layout.js';

const MM_TO_PT = 72 / 25.4;

function dataUrlToBytes(dataUrl) {
  const base64 = String(dataUrl).split(',')[1] || '';
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Mete un PNG en una hoja A4, a tamaño real, sin márgenes. */
export async function pngAPdfA4(pngBytes) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PageWmm * MM_TO_PT, PageHmm * MM_TO_PT]);
  const img = await doc.embedPng(pngBytes);
  page.drawImage(img, {
    x: 0, y: 0, width: PageWmm * MM_TO_PT, height: PageHmm * MM_TO_PT,
  });
  return doc.save();
}

/**
 * Arma los archivos de las dos cartas de una sesión.
 * @param {number} sessionId
 * @returns {Promise<Array<{name:string, bytes:Uint8Array}>>}
 */
export async function construirCartasArchivos(sessionId) {
  const roles = [
    { role: 0, slug: '1-REFERENCIA', etiqueta: 'CARTA DE COLOR - REFERENCIA' },
    { role: 1, slug: '2-A-CORREGIR', etiqueta: 'CARTA DE COLOR - A CORREGIR' },
  ];
  const out = [];
  for (const r of roles) {
    const dataUrl = renderChartToDataURL({
      etiqueta: r.etiqueta, sessionId, role: r.role, withCode: true,
    });
    const png = dataUrlToBytes(dataUrl);
    out.push({ name: `carta-${sessionId}-${r.slug}.png`, bytes: png });
    // eslint-disable-next-line no-await-in-loop
    out.push({ name: `carta-${sessionId}-${r.slug}.pdf`, bytes: await pngAPdfA4(png) });
  }
  out.push({ name: `carta-${sessionId}-COMO USARLA.txt`, bytes: textoInstrucciones(sessionId) });
  return out;
}

function textoInstrucciones(sessionId) {
  const t = [
    'CARTA DE COLOR DE PRINTLAYOUT',
    '=============================',
    '',
    `Sesión: ${sessionId}`,
    '',
    'Son dos cartas de 343 colores, con un código abajo que la app lee sola para',
    'saber cuál es cuál. NO las mezcles con cartas de otra sesión.',
    '',
    '  carta-...-1-REFERENCIA : va en la impresora BUENA (la que querés imitar)',
    '  carta-...-2-A-CORREGIR : va en la impresora que estás corrigiendo',
    '',
    'CÓMO IMPRIMIRLAS',
    '  - Usá el PDF, no el PNG: el PDF ya está en A4 a tamaño real. El PNG, según',
    '    el programa, puede salir escalado y después el lector no encuentra los',
    '    parches.',
    '  - Imprimí SIN ajustar a la página y SIN ninguna corrección de color.',
    '  - Mismo papel y misma calidad que vas a usar para los trabajos.',
    '',
    'CÓMO ESCANEARLAS',
    '  - La hoja entera, color, 300 dpi, JPEG máxima calidad.',
    '  - Sin ajustes automáticos de brillo/color.',
    '  - No escribas sobre los parches.',
    '',
    'DESPUÉS',
    '  Volvé a PrintLayout, sección Color -> "Medir resultado", y cargá los dos',
    '  escaneos. Te dice cuánto se parecen de verdad.',
    '',
  ].join('\r\n');
  return new TextEncoder().encode(t);
}
