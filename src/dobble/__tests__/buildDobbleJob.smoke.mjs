// Smoke test (node, sin DOM real) de la parte PURA del posado Dobble:
//   - dobbleGeometryFromTemplate (⌀ carta = ladoCelda − 2·margenCorte; sangrado = margen)
//   - grilla (computeBestGrid) + cortes circulares (generateCuts)
//   - assignments / paginación / multipágina que arma buildDobbleJob
//   - estiloConFondo: precedencia de fondo (override manual > receta > default)
//   - pageBackground: fondo por hoja del preview (combo pages=[A,A,B] → A,A,B)
//   - validarReceta: el fixture (engine 0.4.0) coincide con el vendor → SIN aviso de mismatch
//
// Corré:  npm run test:dobble     (o)   node src/dobble/__tests__/buildDobbleJob.smoke.mjs
//
// buildDobbleJob rasteriza por canvas; acá stubeamos Image/canvas con ~10 líneas
// (no se instala ni se usa un DOM real) sólo para poder ejercitar la lógica de
// assignments. Las aserciones NO miran el raster, sólo geometría/assignments.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- stub mínimo de navegador para el rasterizador (no es un DOM real) ---
globalThis.Image = class {
  constructor() { this.naturalWidth = 100; this.naturalHeight = 100; this.width = 100; this.height = 100; }
  set src(_v) { Promise.resolve().then(() => this.onload && this.onload()); }
};
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ imageSmoothingEnabled: true, imageSmoothingQuality: 'high', fillStyle: null, fillRect() {}, drawImage() {} }),
    toDataURL: () => 'data:image/png;base64,AA==',
  }),
};

const { buildDobbleJob, dobbleGeometryFromTemplate, buildComboTemplate, dobbleCardCapacity, estiloConFondo } = await import('../buildDobbleJob.js');
const { computeBestGrid, generateCuts } = await import('../../lib/grid.js');
const { pageBackground } = await import('../../lib/templates.js');
const { validarReceta } = await import('../vendor/receta.js');
const { renderDorsoSVG } = await import('../vendor/render.js');

const receta = JSON.parse(readFileSync(join(__dirname, '../__fixtures__/mazo-n3.receta.json'), 'utf-8'));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + msg); } };
const near = (a, b, t = 0.05) => Math.abs(a - b) <= t;

// Plantilla redonda guardada de referencia (como la que crea la grilla rápida).
function circleTemplate({ paperW = 210, paperH = 297, side, cutMargin, markMargin = 10, doubleSided = false }) {
  const margin = markMargin + 2;
  const grid = computeBestGrid(
    { paperW, paperH, cellW: side, cellH: side, marginX: margin, marginY: margin, spacingX: 3, spacingY: 3 },
    { rotateMode: 'direct' },
  );
  const celdas = grid.cells.map((c, i) => ({ id: i, x: c.x, y: c.y, w: c.w, h: c.h }));
  return {
    id: 'tpl_smoke', name: 'Redonda smoke', pageWidthMm: paperW, pageHeightMm: paperH, pageCount: 1,
    celdas, celdasDorso: [], cortes: generateCuts(celdas, { cutShape: 'circle', cutMarginMm: cutMargin }),
    cutMarginMm: cutMargin, markMarginMm: markMargin, cutShape: 'circle', doubleSided, singlePage: true,
  };
}

// 0) Alineación de engineVersion: el fixture (0.4.0) coincide con el vendor
//    re-vendorizado → sin aviso de mismatch.
{
  const v = validarReceta(receta);
  ok(v.ok, 'validarReceta.ok');
  ok((v.avisos || []).every((a) => !/engineVersion/i.test(a)), `sin aviso de engineVersion (avisos: ${JSON.stringify(v.avisos)})`);
}

// 0b) Precedencia del fondo de carta (Orden 3): el override MANUAL de PrintLayout
//     gana; si no se setea, cae al fondo que trae la RECETA; último recurso, blanco.
{
  console.log('# precedencia de fondo (receta vs override)');
  const cartaBase = { forma: 'circulo', fondo: '#111111', diametroMM: 65, radioBorde: 0.14, borde: { color: '#000', grosorMM: 1 } };
  const cartaConImg = { ...cartaBase, fondoImagen: 'data:image/png;base64,RECETA' };
  // 1) Sin override → hereda el fondo (color + imagen) de la receta.
  const e1 = estiloConFondo(cartaConImg, null, null);
  ok(e1.fondoImagen === 'data:image/png;base64,RECETA', 'imagen: sin override usa la de la receta');
  ok(e1.fondo === '#111111', 'color: sin override usa el de la receta');
  // 2) Override manual gana sobre la receta (color + imagen).
  const e2 = estiloConFondo(cartaConImg, '#ff0000', 'data:image/png;base64,OVERRIDE');
  ok(e2.fondoImagen === 'data:image/png;base64,OVERRIDE', 'imagen: override manual gana');
  ok(e2.fondo === '#ff0000', 'color: override manual gana');
  // 3) Receta sin fondoImagen y sin override → null (no inventa imagen).
  const e3 = estiloConFondo(cartaBase, null, null);
  ok(e3.fondoImagen === null, 'imagen: receta sin fondoImagen → null');
  ok(e3.fondo === '#111111', 'color: cae al de la receta');
  // 4) Sin nada → blanco / sin imagen.
  const e4 = estiloConFondo({ forma: 'circulo', diametroMM: 65, radioBorde: 0.14, borde: { color: '#000', grosorMM: 1 } }, null, null);
  ok(e4.fondo === '#ffffff', 'color: default blanco');
  ok(e4.fondoImagen === null, 'imagen: default null');
}

// 0c) Fondo por hoja del preview (Orden 3): en un combo pages=[A,A,B] cada hoja
//     resuelve SU fondo. Hojas 1-2 comparten cache (bgKey A); la 3 usa B. Prueba
//     la lógica pura del fix del preview (renderPdfPage1Preview usa pageBackground).
{
  console.log('# fondo por hoja del preview (combo A,A,B)');
  const combo = {
    id: 'tpl_bg', pageWidthMm: 210, pageHeightMm: 297,
    pages: [
      { pdfBase64: 'PDF_A', bgKey: 'A', celdas: [] },
      { pdfBase64: 'PDF_A', bgKey: 'A', celdas: [] },
      { pdfBase64: 'PDF_B', bgKey: 'B', celdas: [] },
    ],
  };
  const b0 = pageBackground(combo, 0);
  const b1 = pageBackground(combo, 1);
  const b2 = pageBackground(combo, 2);
  ok(b0.b64 === 'PDF_A' && b1.b64 === 'PDF_A', 'hojas 1-2 usan el fondo de A');
  ok(b2.b64 === 'PDF_B', 'hoja 3 usa el fondo de B (su propio pdfBase64)');
  ok(b0.bgKey === b1.bgKey && b0.bgKey !== b2.bgKey, 'cache: A y A comparten clave; B es otra (hoja 3 no muestra el de A)');
  // Plantilla de 1 hoja (sin pages): siempre el top-level, clave estable.
  const single = { id: 'tpl_s', pdfBase64: 'PDF_TOP', pageWidthMm: 210, pageHeightMm: 297 };
  const s0 = pageBackground(single, 0), s2 = pageBackground(single, 2);
  ok(s0.b64 === 'PDF_TOP' && s2.b64 === 'PDF_TOP' && s0.bgKey === '__tpl__', 'single-page: top-level en toda hoja');
  // Sin ningún fondo → null (no rompe).
  ok(pageBackground({ id: 'x', pages: [{ celdas: [] }] }, 0).b64 === null, 'sin fondo → null');
}

// 0d) Dorso: honra la imagen de fondo que trae la receta (motor 0.5.0). El
//     spread que arma buildDobbleJob NO debe perder dorso.fondoImagen, y el
//     motor la dibuja recortada a la forma + sangrado.
{
  console.log('# dorso con fondoImagen (motor 0.5.0)');
  const IMG = 'data:image/png;base64,ZZZdorso';
  const recetaDorso = { fondo: '#123456', tinta: '#ffffff', simbolo: '★', texto: 'DOBBLE', fondoImagen: IMG };
  // Igual que buildDobbleJob: spread de receta.dorso + override SOLO del color.
  const dorso = { ...recetaDorso, fondo: recetaDorso.fondo ?? '#2f6df6' };
  ok(dorso.fondoImagen === IMG, 'el spread NO pierde dorso.fondoImagen');
  const svg = renderDorsoSVG(dorso, {}, { bleedNorm: 0.1 });
  ok(svg.includes('<image') && svg.includes(IMG), 'el SVG del dorso incluye la imagen de la receta');
  ok(/clippath/i.test(svg), 'la imagen del dorso va recortada a la forma (clipPath)');
  // Sin fondoImagen → solo color, sin <image> (comportamiento previo, sin regresión).
  const svgSolo = renderDorsoSVG({ fondo: '#123456' }, {}, { bleedNorm: 0.1 });
  ok(!svgSolo.includes('<image'), 'sin fondoImagen el dorso queda en color sólido (sin imagen)');
}

async function check(label, tpl, opts = {}) {
  const cartas = receta.cartas.length;
  const geo = dobbleGeometryFromTemplate(tpl);
  const { spec, error } = await buildDobbleJob(receta, { template: tpl, ...opts });
  console.log(`# ${label}`);
  ok(geo.ok, `geo.ok (${geo.reason || ''})`);
  ok(near(geo.diam, geo.side - 2 * geo.cutMargin), `⌀ carta = lado − 2·margen (${geo.diam} = ${geo.side} − 2·${geo.cutMargin})`);
  ok(near(geo.bleed, geo.cutMargin), 'sangrado = margen de corte');
  ok(geo.cellsPerPage === tpl.celdas.length, `cellsPerPage = celdas (${geo.cellsPerPage})`);
  // corte circular: ⌀ ≈ ⌀ carta
  const poly = tpl.cortes[0];
  const cx = tpl.celdas[0].x + tpl.celdas[0].w / 2, cy = tpl.celdas[0].y + tpl.celdas[0].h / 2;
  let r = 0; for (const [x, y] of poly) r = Math.max(r, Math.hypot(x - cx, y - cy));
  ok(near(r * 2, geo.diam, 0.2), `corte ⌀ ≈ carta ⌀ (${(r * 2).toFixed(2)} ≈ ${geo.diam})`);
  ok(!!spec, `spec presente (${error || ''})`);
  if (!spec) return;
  const cpp = geo.cellsPerPage;
  const expDouble = opts.dobleFaz != null ? !!opts.dobleFaz : !!tpl.doubleSided;
  ok(spec.images.length === cartas + (expDouble ? 1 : 0), `images = cartas${expDouble ? '+dorso' : ''} (${spec.images.length})`);
  ok(spec.assignmentsFront.length % cpp === 0, `front múltiplo de ${cpp} (${spec.assignmentsFront.length})`);
  ok(spec.minPages === Math.ceil(cartas / cpp), `minPages = ceil(${cartas}/${cpp}) (${spec.minPages})`);
  ok(spec.assignmentsFront.slice(0, cartas).every((x) => x != null), 'primeras N celdas asignadas');
  ok(spec.assignmentsFront.slice(cartas).every((x) => x == null), 'relleno con null');
  ok(spec.template.cortes.length === tpl.cortes.length, 'cortes de la plantilla preservados');
  ok(near(spec.template.dobble.diametroMM, geo.diam), 'dobble.diametroMM = ⌀ carta');
  if (expDouble) {
    ok(spec.assignmentsBack.length === spec.assignmentsFront.length, 'back y front misma longitud');
    ok(spec.assignmentsBack.slice(0, cartas).every((x) => x != null), 'dorso asignado');
  }
}

await check('n3 · 1 hoja (⌀65, sangrado 3)', circleTemplate({ side: 71, cutMargin: 3 }));
await check('n3 · multipágina (celda chica)', circleTemplate({ side: 56, cutMargin: 3 }));
await check('n3 · doble faz', circleTemplate({ side: 71, cutMargin: 3.5, doubleSided: true }));

// --- Combo 3 hojas (pages=[A,A,B]) · 2 roles (card + caja) · DOBLE FAZ ---
// Las instrucciones/QR van horneadas en el fondo del Corel (no son celdas).
async function checkCombo() {
  const mk = (role, i, w = 65, h = 65) => ({ id: i, x: (i % 6) * 68, y: 0, w, h, role });
  const cardGrid = (n) => Array.from({ length: n }, (_, i) => mk('card', i));
  const A = { celdas: cardGrid(6), celdasDorso: cardGrid(6), pdfBase64: 'AAAA', bgKey: 'A' };
  const B = {
    celdas: [mk('card', 0), mk('card', 1), mk('card', 2), mk('caja', 3, 180, 120), mk('frente-caja', 4, 60, 60)],
    celdasDorso: [mk('card', 0), mk('card', 1), mk('card', 2), mk('caja', 3, 180, 120), mk('frente-caja', 4, 60, 60)],
    pdfBase64: 'BBBB', bgKey: 'B',
  };
  const tpl = { id: 'tpl_combo', name: 'Combo 3 hojas', pageWidthMm: 210, pageHeightMm: 297, pages: [A, A, B], doubleSided: true };

  const res = await buildDobbleJob(receta, { template: tpl });
  const spec = res.spec;
  console.log('# combo 3 hojas [A,A,B] · doble faz · MVP (caja en blanco)');
  ok(!!spec, `spec presente (${res.error || ''})`);
  if (!spec) return;
  const AF = spec.assignmentsFront, AB = spec.assignmentsBack;
  // flat: p0 0-5 card · p1 6-11 card · p2 12,13,14 card / 15 caja / 16 frente-caja
  ok(spec.template.dobble.combo === true, 'dobble.combo=true');
  ok(spec.template.dobble.doubleSided === true && spec.template.doubleSided === true, 'doubleSided=true');
  ok(spec.minPages === 3, 'minPages=3');
  ok(AF.length === 17, `front length = 17 (6+6+5) (got ${AF.length})`);
  ok(AF.slice(0, 12).every((x) => x != null) && AF[12] != null, '13 cartas en hojas 1-2-3 (12+1)');
  ok(AF[13] == null && AF[14] == null, 'cards sobrantes de hoja 3 vacías');
  ok(AF[15] == null && AF[16] == null, 'MVP: caja/frente EN BLANCO (sin opts.caja)');
  // DOBLE FAZ: dorso compartido solo en las celdas card con carta
  ok(AB.length === AF.length, 'back y front misma longitud');
  const dorsoId = AB[0];
  ok(dorsoId != null && AB.slice(0, 12).every((x) => x === dorsoId) && AB[12] === dorsoId, 'dorso compartido en las 13 card cells');
  ok(AB[13] == null && AB[14] == null && AB[15] == null && AB[16] == null, 'dorso NO en cards vacías ni caja');
  const cardIds = new Set(AF.slice(0, 13).filter(Boolean));
  ok(!cardIds.has(dorsoId), 'dorso es una imagen distinta de las cartas');
  ok(spec.images.length === 14, `images = 13 cartas + 1 dorso = 14 (got ${spec.images.length})`);
  ok(!res.warning, `sin warning (13 ≤ 15 card cells) (${res.warning || ''})`);
}
await checkCombo();

// --- buildComboTemplate: arma pages=[A,A,B] desde 2 plantillas de Corel ---
async function checkComboBuild() {
  const mk = (i, w = 65, h = 65) => ({ id: i, x: (i % 6) * 68, y: 0, w, h }); // sin role (default card)
  const A = { id: 'tA', name: 'Hoja cartas', pageWidthMm: 210, pageHeightMm: 297, doubleSided: true,
    pdfBase64: 'PDF_A', celdas: Array.from({ length: 6 }, (_, i) => mk(i)), celdasDorso: Array.from({ length: 6 }, (_, i) => mk(i)) };
  const B = { id: 'tB', name: 'Hoja caja', pageWidthMm: 210, pageHeightMm: 297, doubleSided: true,
    pdfBase64: 'PDF_B', celdas: [mk(0), mk(1), mk(2), { id: 3, x: 0, y: 150, w: 180, h: 100 }], celdasDorso: [mk(0), mk(1), mk(2)] };
  const { template: combo, error } = buildComboTemplate(A, B, { name: 'Mazo Dobble' });
  console.log('# buildComboTemplate (A,A,B)');
  ok(!!combo, `combo armado (${error || ''})`);
  if (!combo) return;
  ok(combo.pages.length === 3, 'pages.length=3');
  ok(combo.doubleSided === true, 'combo doubleSided');
  ok(combo.pages[0].bgKey === 'A' && combo.pages[1].bgKey === 'A' && combo.pages[2].bgKey === 'B', 'bgKey A,A,B');
  ok(combo.pages[0].pdfBase64 === 'PDF_A' && combo.pages[2].pdfBase64 === 'PDF_B', 'pdfBase64 per-hoja A/B');
  ok(combo.pages[0].celdas.every((c) => c.role === 'card'), 'A: todas card');
  const bRoles = combo.pages[2].celdas.map((c) => c.role);
  ok(bRoles.slice(0, 3).every((r) => r === 'card') && bRoles[3] === 'caja', 'B: 3 card + 1 caja (por tamaño vs carta de A)');
  const cap = dobbleCardCapacity(combo);
  ok(cap.multi && cap.pages === 3 && cap.cardCells === 15, `capacidad: 15 card cells en 3 hojas (got ${cap.cardCells})`);
  // Posar sobre el combo: la caja de B (flat idx 15) NO recibe carta; doble faz OK.
  const res = await buildDobbleJob(receta, { template: combo });
  ok(!!res.spec && res.spec.assignmentsFront[15] == null, 'la celda caja de B queda vacía al posar');
  ok(!!res.spec && res.spec.template.doubleSided === true, 'combo posado es doble faz');
}
await checkComboBuild();

// --- Overflow: mazo más grande que las card cells → warning (no trunca en silencio) ---
async function checkOverflow() {
  const mk = (i) => ({ id: i, x: 0, y: i * 70, w: 65, h: 65, role: 'card' });
  const A = { celdas: [mk(0), mk(1)], celdasDorso: [mk(0), mk(1)], pdfBase64: 'A', bgKey: 'A' };
  const B = { celdas: [mk(0)], celdasDorso: [mk(0)], pdfBase64: 'B', bgKey: 'B' };
  const tpl = { name: 'Combo chico', pageWidthMm: 210, pageHeightMm: 297, pages: [A, A, B], doubleSided: true };
  const res = await buildDobbleJob(receta, { template: tpl }); // 13 cartas, 5 card cells
  console.log('# overflow (13 cartas, 5 celdas card)');
  ok(!!res.spec, 'spec presente');
  ok(!!res.warning && /sobran/.test(res.warning), `warning de overflow (${res.warning || 'NINGUNO'})`);
  ok(res.spec.assignmentsFront.filter((x) => x != null).length === 5, 'posa 5 cartas (las que entran), no trunca en silencio');
}
await checkOverflow();

console.log(`\n==== ${pass} OK, ${fail} FALLOS ====`);
process.exit(fail ? 1 : 0);
