// render.js — Renderer PORTABLE de una carta.
//
// Emite un STRING SVG (no construye nodos del DOM): la misma salida sirve en
// Dobble (preview), la web (preview) y PrintLayout (impresión). No depende del
// navegador ni de ninguna app.
//
// Coordenadas normalizadas: la carta es la forma de **radio 1** centrada en (0,0)
// — radio 1 = BORDE DE CORTE de la carta. El sangrado NO se hornea acá: se pasa
// explícito en `bleedNorm` (fracción del radio) sólo cuando se quiere, y extiende
// el fondo más allá del radio 1 sin mover el borde ni los símbolos.
//
// x→derecha, y→abajo; rotación en grados horario. Cada placement = {x,y,r,rot,i}
// donde `i` indexa en `simbolos` (lista única en orden de índice).

const FUENTE_EMOJI =
  '&quot;Segoe UI Emoji&quot;,&quot;Apple Color Emoji&quot;,&quot;Noto Color Emoji&quot;,sans-serif';

/** Sangrado normalizado (fracción del radio) para un diámetro y bleed físicos. */
export function bleedNormal(diametroMM, bleedMM) {
  if (!(diametroMM > 0)) return 0;
  return (bleedMM || 0) / (diametroMM / 2);
}

/** Redondea a 5 decimales y limpia ceros: congela la geometría de forma estable. */
function num(v) {
  const r = Math.round(v * 1e5) / 1e5;
  return Object.is(r, -0) ? '0' : String(r);
}

/** Escapa un valor de atributo (comillas dobles). */
function attr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Escapa texto (contenido de <text>). */
function texto(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Elemento de forma (círculo | cuadrado redondeado) como string, con atributos extra. */
function forma(tipo, half, radioBorde, extra = '') {
  if (tipo === 'cuadrado') {
    const rx = Math.max(0, radioBorde) * 2 * half;
    return (
      `<rect x="${num(-half)}" y="${num(-half)}" width="${num(2 * half)}" ` +
      `height="${num(2 * half)}" rx="${num(rx)}" ry="${num(rx)}"${extra}/>`
    );
  }
  return `<circle cx="0" cy="0" r="${num(half)}"${extra}/>`;
}

function normalizarEstilo(estilo = {}) {
  const borde = estilo.borde ?? {};
  return {
    forma: estilo.forma ?? 'circulo',
    fondo: estilo.fondo ?? '#ffffff',
    bordeColor: borde.color ?? '#1f2430',
    bordeGrosor: borde.grosor ?? 0.02, // normalizado (fracción del radio 1)
    radioBorde: estilo.radioBorde ?? 0.14,
  };
}

/** ¿El símbolo es una imagen? Devuelve también su URL/ref (string) si aplica. */
function imagenDe(sim) {
  if (!sim) return { esImg: false };
  const esImg = sim.tipo === 'img' || sim.kind === 'img';
  const url = sim.dataUrl ?? sim.url ?? sim.ref ?? sim.v;
  return { esImg, url };
}

/**
 * Renderiza una carta a SVG (string).
 * @param {object} args
 * @param {Array<{x:number,y:number,r:number,rot:number,i:number}>} args.placements
 * @param {Array<object>} args.simbolos  Lista única en orden de índice.
 * @param {object} [args.estilo]         {forma, fondo, borde:{color,grosor}, radioBorde}
 * @param {number} [args.bleedNorm=0]    Sangrado normalizado (extiende el fondo más allá de radio 1).
 * @param {string} [args.idPrefijo='c']  Prefijo de ids (único por carta al inlinear varias).
 * @returns {string} SVG
 */
export function renderCartaSVG({ placements, simbolos, estilo, bleedNorm = 0, idPrefijo = 'c' }) {
  const e = normalizarEstilo(estilo);
  const borde = Math.max(0, e.bordeGrosor);
  const ext = 1 + Math.max(0, bleedNorm); // medio-lado del viewBox (incluye sangrado)
  const vb = `${num(-ext)} ${num(-ext)} ${num(2 * ext)} ${num(2 * ext)}`;

  const idClip = `${idPrefijo}-clip`;
  const partes = [];
  partes.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `viewBox="${vb}" preserveAspectRatio="xMidYMid meet">`
  );

  // defs: clip a la forma interior + imágenes únicas usadas en esta carta.
  const defs = [`<clipPath id="${idClip}">${forma(e.forma, 1 - borde, e.radioBorde)}</clipPath>`];
  const idsImg = new Map();
  for (const p of placements) {
    const { esImg, url } = imagenDe(simbolos[p.i]);
    if (esImg && url != null && !idsImg.has(p.i)) {
      const id = `${idPrefijo}-i${p.i}`;
      idsImg.set(p.i, id);
      defs.push(
        `<image id="${id}" href="${attr(url)}" xlink:href="${attr(url)}" ` +
          `x="-0.5" y="-0.5" width="1" height="1" preserveAspectRatio="xMidYMid meet"/>`
      );
    }
  }
  partes.push(`<defs>${defs.join('')}</defs>`);

  // Fondo (extendido al sangrado si bleedNorm>0).
  partes.push(forma(e.forma, ext, e.radioBorde, ` fill="${attr(e.fondo)}"`));
  // Borde: anillo con su contorno sobre la línea de corte (radio 1).
  if (borde > 0) {
    partes.push(
      forma(
        e.forma,
        1 - borde / 2,
        e.radioBorde,
        ` fill="none" stroke="${attr(e.bordeColor)}" stroke-width="${num(borde)}"`
      )
    );
  }

  // Símbolos (recortados a la forma interior).
  partes.push(`<g clip-path="url(#${idClip})">`);
  for (const p of placements) {
    const sim = simbolos[p.i];
    const { esImg, url } = imagenDe(sim);
    const rot = num(p.rot ?? p.rotacion ?? 0);
    const x = num(p.x);
    const y = num(p.y);
    const r = p.r ?? p.radio;
    if (esImg && url != null) {
      const id = idsImg.get(p.i);
      partes.push(
        `<use href="#${id}" xlink:href="#${id}" ` +
          `transform="translate(${x} ${y}) rotate(${rot}) scale(${num(2 * r)})"/>`
      );
    } else if (sim) {
      // Emoji u otro carácter (sólo preview en pantalla).
      const ch = sim.char ?? sim.v ?? '';
      partes.push(
        `<g transform="translate(${x} ${y}) rotate(${rot})">` +
          `<text text-anchor="middle" dominant-baseline="central" ` +
          `font-size="${num(2 * r * 0.95)}" font-family="${FUENTE_EMOJI}">${texto(ch)}</text></g>`
      );
    }
  }
  partes.push('</g></svg>');
  return partes.join('');
}

/**
 * Renderiza el dorso de la carta a SVG (string), con la misma forma/viewBox.
 * @param {object} dorso  {fondo, tinta, simbolo, texto}
 * @param {object} estilo {forma, borde:{color,grosor}, radioBorde}
 * @param {object} [opc]  {bleedNorm, }
 */
export function renderDorsoSVG(dorso = {}, estilo, { bleedNorm = 0 } = {}) {
  const e = normalizarEstilo(estilo);
  const borde = Math.max(0, e.bordeGrosor);
  const fondo = dorso.fondo ?? '#2f6df6';
  const tinta = dorso.tinta ?? '#ffffff';
  const simbolo = dorso.simbolo ?? '';
  const txt = dorso.texto ?? '';
  const ext = 1 + Math.max(0, bleedNorm);
  const vb = `${num(-ext)} ${num(-ext)} ${num(2 * ext)} ${num(2 * ext)}`;

  const partes = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">`,
    forma(e.forma, ext, e.radioBorde, ` fill="${attr(fondo)}"`),
  ];
  if (borde > 0) {
    partes.push(
      forma(e.forma, 1 - borde / 2, e.radioBorde,
        ` fill="none" stroke="${attr(e.bordeColor)}" stroke-width="${num(borde)}"`)
    );
  }
  // Anillo decorativo.
  partes.push(
    forma(e.forma, 0.78, e.radioBorde,
      ` fill="none" stroke="${attr(tinta)}" stroke-width="${num(0.012)}" stroke-opacity="0.5"`)
  );
  if (simbolo) {
    const fs = txt ? 0.7 : 0.9;
    const yy = txt ? -0.08 : 0;
    partes.push(
      `<text x="0" y="${num(yy)}" text-anchor="middle" dominant-baseline="central" ` +
        `font-size="${num(fs)}" font-family="${FUENTE_EMOJI}">${texto(simbolo)}</text>`
    );
  }
  if (txt) {
    partes.push(
      `<text x="0" y="${num(0.52)}" text-anchor="middle" dominant-baseline="central" ` +
        `font-size="${num(0.16)}" font-weight="700" letter-spacing="${num(0.02)}" ` +
        `font-family="system-ui,-apple-system,sans-serif" fill="${attr(tinta)}">${texto(txt)}</text>`
    );
  }
  partes.push('</svg>');
  return partes.join('');
}
