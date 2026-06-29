// Smoke test (node, sin DOM real) de la parte PURA del posado Dobble:
//   - dobbleGeometryFromTemplate (⌀ carta = ladoCelda − 2·margenCorte; sangrado = margen)
//   - grilla (computeBestGrid) + cortes circulares (generateCuts)
//   - assignments / paginación / multipágina que arma buildDobbleJob
//   - validarReceta: el fixture (engine 0.3.0) coincide con el vendor → SIN aviso de mismatch
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
globalThis.Image = class { set src(_v) { Promise.resolve().then(() => this.onload && this.onload()); } };
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ imageSmoothingEnabled: true, imageSmoothingQuality: 'high', fillStyle: null, fillRect() {}, drawImage() {} }),
    toDataURL: () => 'data:image/png;base64,AA==',
  }),
};

const { buildDobbleJob, dobbleGeometryFromTemplate } = await import('../buildDobbleJob.js');
const { computeBestGrid, generateCuts } = await import('../../lib/grid.js');
const { validarReceta } = await import('../vendor/receta.js');

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

// 0) Alineación de engineVersion: el fixture no debe disparar aviso de mismatch.
{
  const v = validarReceta(receta);
  ok(v.ok, 'validarReceta.ok');
  ok((v.avisos || []).every((a) => !/engineVersion/i.test(a)), `sin aviso de engineVersion (avisos: ${JSON.stringify(v.avisos)})`);
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

console.log(`\n==== ${pass} OK, ${fail} FALLOS ====`);
process.exit(fail ? 1 : 0);
