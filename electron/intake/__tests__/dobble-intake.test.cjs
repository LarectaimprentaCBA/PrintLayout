// Test del exportador Dobble AUTOMÁTICO a nivel servicio (main), con Supabase /
// electron / config-store MOCKEADOS y el disco real en una carpeta temp.
//
// Simula un pedido_dobble pendiente y verifica el flujo sin intervención:
//   1) el poller lo detecta, baja <id>/receta.json (+ caja.jpg) a temp y emite
//      'intake:dobble-order-ready' con los paths locales;
//   2) el renderer puede leer la receta vía readFile (validación por prefijo);
//   3) al confirmar el armado (dobbleOrderBuilt ok:true) se MARCA procesado,
//      se borran los objetos del bucket y se limpia el temp.
// Además prueba el guardado SILENCIOSO (writePdfSilent, sin diálogo) y el nombre
// "PR-<presupuesto> - <mazo>.pdf" (dobblePdfFileName).
//
// Correr:  npm run test:dobble-intake   (o)  node electron/intake/__tests__/dobble-intake.test.cjs

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('module');

const TMP = path.join(os.tmpdir(), `pl-dobble-intake-${process.pid}`);
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const OUT = path.join(TMP, 'salida');

// Receta real (engine 0.4.0, n=3) sólo para que el emit lleve algo parseable.
const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'dobble', '__fixtures__', 'mazo-n3.receta.json'),
  'utf-8',
));

const ORDER = {
  id: 'uuid-abc-123',
  numero_presupuesto: '500',
  receta_path: 'uuid-abc-123/receta.json',
  caja_path: 'uuid-abc-123/caja.jpg',
  doble_faz: true,
  nombre_mazo: 'Mazo de Prueba',
  procesado_printlayout: false,
};

// Config mockeada: modo La Recta + activo + dobbleActive, carpeta temp.
const CFG = {
  supabaseUrl: 'http://sb.local', serviceKey: 'k', activo: true, laRecta: true,
  dobbleActive: true, outputDir: TMP, dobbleOutputDir: OUT, pollSeconds: 60, modoEntrega: 'carpeta',
};
const calls = { downloads: [], mark: [], remove: [] };

const configStub = {
  load: () => ({ ...CFG }),
  save: (p) => ({ ...CFG, ...(p || {}) }),
  isLaRecta: () => true,
  MIN_POLL: 15, DEFAULTS: {},
};
const supaStub = {
  // fotos: sin pendientes (pollBoth también corre el tick de fotos).
  listPendingOrders: async () => [],
  downloadObject: async () => Buffer.from(''),
  markProcessed: async () => true,
  removeObjects: async () => true,
  upsertCatalog: async () => true,
  upsertConfig: async () => true,
  // dobble
  listPendingDobble: async () => [{ ...ORDER }],
  downloadDobbleObject: async (_cfg, p) => {
    calls.downloads.push(p);
    if (String(p).endsWith('receta.json')) return Buffer.from(JSON.stringify(FIXTURE), 'utf-8');
    return Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // "jpeg"
  },
  markProcessedDobble: async (_cfg, id) => { calls.mark.push(id); return true; },
  removeDobbleObjects: async (_cfg, paths) => { calls.remove.push(paths); return true; },
};
const electronStub = {
  app: { getPath: () => TMP },
  net: { fetch: async () => { throw new Error('sin red en el test'); } },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  if (request.endsWith('config-store.cjs')) return configStub;
  if (request.endsWith('supabase.cjs')) return supaStub;
  return origLoad.apply(this, arguments);
};

const service = require('../service.cjs');
const { writePdfSilent, dobblePdfFileName } = require('../save-pdf.cjs');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + msg); } };

async function main() {
  // Capturamos los eventos que el main manda al renderer.
  const events = [];
  const fakeWin = {
    isDestroyed: () => false,
    webContents: { send: (ch, payload) => events.push({ ch, payload }) },
  };
  service.start(fakeWin); // programa timers (no disparan antes del exit)

  // --- 1) Un ciclo manual: detecta el pendiente y lo baja ---
  const res = await service.pollNow();
  ok(res && res.ok, 'pollNow ok');
  ok(res.found >= 1, `encontró ≥1 pedido (found=${res.found})`);

  const ready = events.find((e) => e.ch === 'intake:dobble-order-ready');
  ok(!!ready, 'emitió intake:dobble-order-ready');
  if (!ready) return finish();
  const pl = ready.payload;
  ok(pl.numero_presupuesto === '500', `payload numero_presupuesto (${pl.numero_presupuesto})`);
  ok(pl.doble_faz === true, 'payload doble_faz=true');
  ok(typeof pl.recetaPath === 'string' && pl.recetaPath.endsWith('receta.json'), 'payload recetaPath a receta.json');
  ok(typeof pl.cajaPath === 'string' && pl.cajaPath.endsWith('caja.jpg'), 'payload cajaPath a caja.jpg');
  ok(fs.existsSync(pl.recetaPath) && fs.existsSync(pl.cajaPath), 'receta + caja escritas en temp');
  ok(calls.downloads.includes('uuid-abc-123/receta.json') && calls.downloads.includes('uuid-abc-123/caja.jpg'),
    'bajó receta + caja del bucket dobble');

  // --- 2) El renderer lee la receta vía readFile (validación por prefijo) ---
  const recetaBytes = await service.readFile(pl.recetaPath);
  ok(!!recetaBytes, 'readFile devolvió bytes de la receta');
  const parsed = JSON.parse(Buffer.from(recetaBytes).toString('utf-8'));
  ok(parsed && parsed.mazo && parsed.mazo.n === 3, `receta parseable (n=${parsed?.mazo?.n})`);
  // readFile fuera de temp debe rechazarse.
  const outside = await service.readFile(path.join(os.tmpdir(), 'no-permitido.json'));
  ok(outside === null, 'readFile rechaza paths fuera de temp');

  // --- 3) Guardado SILENCIOSO del PDF (sin diálogo) + nombre correcto ---
  const fakePdf = Buffer.from('%PDF-1.7\n% dobble test\n%%EOF\n', 'utf-8');
  const fileName = dobblePdfFileName(ORDER.numero_presupuesto, ORDER.nombre_mazo);
  ok(fileName === 'PR-500 - Mazo de Prueba.pdf', `nombre "PR-500 - Mazo de Prueba.pdf" (got "${fileName}")`);
  const filePath = path.join(OUT, fileName);
  const written = writePdfSilent(filePath, fakePdf);
  ok(fs.existsSync(written), 'writePdfSilent creó el PDF en la carpeta (sin diálogo)');
  ok(fs.readFileSync(written).slice(0, 5).toString() === '%PDF-', 'el archivo guardado es un PDF');
  // Nombre saneado (caracteres inválidos de Windows).
  ok(dobblePdfFileName('12/34', 'A:B*C') === 'PR-12_34 - A_B_C.pdf', 'saneo de caracteres inválidos');

  // --- 4) Confirmación OK → marca procesado + borra del bucket + limpia temp ---
  const orderDir = path.dirname(pl.recetaPath);
  ok(fs.existsSync(orderDir), 'temp del pedido existe antes de confirmar');
  const built = await service.dobbleOrderBuilt({ id: ORDER.id, ok: true });
  ok(built && built.ok, 'dobbleOrderBuilt ok');
  ok(calls.mark.includes(ORDER.id), 'marcó procesado (markProcessedDobble)');
  ok(Array.isArray(calls.remove[0]) && calls.remove[0].includes('uuid-abc-123/receta.json'),
    'borró los objetos del bucket dobble');
  ok(!fs.existsSync(orderDir), 'limpió el temp del pedido');

  // --- 5) Confirmación con error → NO marca (se reintenta) ---
  const markBefore = calls.mark.length;
  const builtFail = await service.dobbleOrderBuilt({ id: 'otro-id', ok: false, error: 'x' });
  ok(builtFail && builtFail.ok, 'dobbleOrderBuilt(ok:false) no rompe');
  ok(calls.mark.length === markBefore, 'no marca procesado cuando el armado falló');

  finish();
}

function finish() {
  Module._load = origLoad;
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  console.log(`\n==== ${pass} OK, ${fail} FALLOS ====`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FALLO:', e); process.exit(1); });
