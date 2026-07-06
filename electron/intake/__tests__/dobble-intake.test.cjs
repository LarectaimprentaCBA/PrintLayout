// Test del exportador Dobble/busca2 AUTOMÁTICO a nivel servicio (main), con
// Supabase / electron / config-store MOCKEADOS y el disco real en una carpeta temp.
//
// Cubre las dos ramas por `origen`:
//   A) 'propio'   (mazo del cliente): baja receta (+caja) → emite order-ready →
//                 el renderer arma → al confirmar se marca procesado + limpia.
//   B) 'catalogo' (mazo nuestro): NO baja nada ni pasa por el renderer; copia el
//                 PDF ya armado (mapa mazo_id→PDF) a la carpeta como
//                 "PR-<presupuesto> - <mazo>.pdf" y marca procesado.
// Además: guardado SILENCIOSO (writePdfSilent, sin diálogo) + nombre correcto.
//
// Correr:  npm run test:dobble-intake

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('module');

const TMP = path.join(os.tmpdir(), `pl-dobble-intake-${process.pid}`);
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const OUT = path.join(TMP, 'salida');

const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'dobble', '__fixtures__', 'mazo-n3.receta.json'),
  'utf-8',
));

// Config mockeada (mutable entre fases): modo La Recta + activo + dobbleActive.
const cfg = {
  supabaseUrl: 'http://sb.local', serviceKey: 'k', activo: true, laRecta: true,
  dobbleActive: true, outputDir: TMP, dobbleOutputDir: OUT, pollSeconds: 60,
  modoEntrega: 'carpeta', dobbleMazoPdfMap: {},
};
let pending = []; // lo que devuelve listPendingDobble (mutable entre fases)
const calls = { downloads: [], mark: [], remove: [] };

const configStub = {
  load: () => ({ ...cfg }),
  save: (p) => Object.assign(cfg, p || {}),
  isLaRecta: () => true,
  MIN_POLL: 15, DEFAULTS: {},
};
const supaStub = {
  listPendingOrders: async () => [],
  downloadObject: async () => Buffer.from(''),
  markProcessed: async () => true,
  removeObjects: async () => true,
  upsertCatalog: async () => true,
  upsertConfig: async () => true,
  listPendingDobble: async () => pending.map((o) => ({ ...o })),
  downloadDobbleObject: async (_cfg, p) => {
    calls.downloads.push(p);
    if (String(p).endsWith('receta.json')) return Buffer.from(JSON.stringify(FIXTURE), 'utf-8');
    return Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  },
  markProcessedDobble: async (_cfg, id) => { calls.mark.push(id); return true; },
  removeDobbleObjects: async (_cfg, paths) => { calls.remove.push(paths); return true; },
};
const electronStub = {
  app: { getPath: () => TMP },
  net: { fetch: async () => { throw new Error('sin red en el test'); } },
};

// Con bypassConfigMock=true, config-store.cjs se carga REAL (para probar sus
// DEFAULTS/saneo); en el resto del test va mockeado (configStub).
let bypassConfigMock = false;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  if (!bypassConfigMock && request.endsWith('config-store.cjs')) return configStub;
  if (request.endsWith('supabase.cjs')) return supaStub;
  return origLoad.apply(this, arguments);
};

const service = require('../service.cjs');
const { writePdfSilent, dobblePdfFileName } = require('../save-pdf.cjs');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + msg); } };

const events = [];
const fakeWin = {
  isDestroyed: () => false,
  webContents: { send: (ch, payload) => events.push({ ch, payload }) },
};

async function main() {
  service.start(fakeWin); // programa timers (no disparan antes del exit)

  // ============ FASE A: pedido 'propio' (mazo del cliente) ============
  console.log('# A) origen=propio (genera sobre el combo)');
  const PROPIO = {
    id: 'uuid-abc-123', numero_presupuesto: '500', origen: 'propio', mazo_id: null,
    receta_path: 'uuid-abc-123/receta.json', caja_path: 'uuid-abc-123/caja.jpg',
    doble_faz: true, nombre_mazo: 'Mazo de Prueba', procesado_printlayout: false,
  };
  pending = [PROPIO];
  const res = await service.pollNow();
  ok(res && res.ok, 'pollNow ok');
  ok(res.found >= 1, `encontró ≥1 pedido (found=${res.found})`);

  const ready = events.find((e) => e.ch === 'intake:dobble-order-ready');
  ok(!!ready, 'emitió intake:dobble-order-ready (propio)');
  const pl = ready ? ready.payload : {};
  ok(pl.numero_presupuesto === '500', `payload numero_presupuesto (${pl.numero_presupuesto})`);
  ok(pl.doble_faz === true, 'payload doble_faz=true');
  ok(typeof pl.recetaPath === 'string' && pl.recetaPath.endsWith('receta.json'), 'payload recetaPath a receta.json');
  ok(typeof pl.cajaPath === 'string' && pl.cajaPath.endsWith('caja.jpg'), 'payload cajaPath a caja.jpg');
  ok(pl.recetaPath && fs.existsSync(pl.recetaPath) && fs.existsSync(pl.cajaPath), 'receta + caja escritas en temp');
  ok(calls.downloads.includes('uuid-abc-123/receta.json') && calls.downloads.includes('uuid-abc-123/caja.jpg'),
    'bajó receta + caja del bucket dobble');

  const recetaBytes = await service.readFile(pl.recetaPath);
  ok(!!recetaBytes, 'readFile devolvió bytes de la receta');
  const parsed = JSON.parse(Buffer.from(recetaBytes).toString('utf-8'));
  ok(parsed && parsed.mazo && parsed.mazo.n === 3, `receta parseable (n=${parsed?.mazo?.n})`);
  const outside = await service.readFile(path.join(os.tmpdir(), 'no-permitido.json'));
  ok(outside === null, 'readFile rechaza paths fuera de temp');

  // Guardado silencioso + nombre.
  const fakePdf = Buffer.from('%PDF-1.7\n% dobble test\n%%EOF\n', 'utf-8');
  const fileName = dobblePdfFileName('500', 'Mazo de Prueba');
  ok(fileName === 'PR-500 - Mazo de Prueba.pdf', `nombre "PR-500 - Mazo de Prueba.pdf" (got "${fileName}")`);
  const written = writePdfSilent(path.join(OUT, fileName), fakePdf);
  ok(fs.existsSync(written), 'writePdfSilent creó el PDF en la carpeta (sin diálogo)');
  ok(fs.readFileSync(written).slice(0, 5).toString() === '%PDF-', 'el archivo guardado es un PDF');
  ok(dobblePdfFileName('12/34', 'A:B*C') === 'PR-12_34 - A_B_C.pdf', 'saneo de caracteres inválidos');

  // Confirmación OK → marca + limpia.
  const orderDir = path.dirname(pl.recetaPath);
  ok(fs.existsSync(orderDir), 'temp del pedido existe antes de confirmar');
  const built = await service.dobbleOrderBuilt({ id: PROPIO.id, ok: true });
  ok(built && built.ok, 'dobbleOrderBuilt ok');
  ok(calls.mark.includes(PROPIO.id), 'marcó procesado (markProcessedDobble)');
  ok(Array.isArray(calls.remove[0]) && calls.remove[0].includes('uuid-abc-123/receta.json'),
    'borró los objetos del bucket dobble');
  ok(!fs.existsSync(orderDir), 'limpió el temp del pedido');

  const markBefore = calls.mark.length;
  const builtFail = await service.dobbleOrderBuilt({ id: 'otro-id', ok: false, error: 'x' });
  ok(builtFail && builtFail.ok, 'dobbleOrderBuilt(ok:false) no rompe');
  ok(calls.mark.length === markBefore, 'no marca procesado cuando el armado falló');

  // ============ FASE B: pedido 'catalogo' (mazo nuestro) ============
  console.log('# B) origen=catalogo (copia el PDF ya armado)');
  // PDF fuente ya armado (el del mundialista) + mapa mazo_id→PDF.
  const srcDir = path.join(TMP, 'catalogo-src');
  fs.mkdirSync(srcDir, { recursive: true });
  const srcPdf = path.join(srcDir, 'mundialista.pdf');
  fs.writeFileSync(srcPdf, Buffer.from('%PDF-1.7\n% mundialista ya armado\n%%EOF\n', 'utf-8'));
  // Fuente con fecha vieja: la copia debe quedar con "ahora", no heredar esta.
  const oldDate = new Date(Date.now() - 5 * 864e5);
  fs.utimesSync(srcPdf, oldDate, oldDate);
  cfg.dobbleMazoPdfMap = { 10: srcPdf };

  const CATALOGO = {
    id: 'uuid-cat-1', numero_presupuesto: '777', origen: 'catalogo', mazo_id: 10,
    receta_path: null, caja_path: null, doble_faz: true, nombre_mazo: 'Mundialista',
    procesado_printlayout: false,
  };
  pending = [CATALOGO];
  const downloadsBefore = calls.downloads.length;
  const eventsBefore = events.length;
  const markBefore2 = calls.mark.length;
  const removeBefore = calls.remove.length;

  await service.pollNow();

  const dest = path.join(OUT, 'PR-777 - Mundialista.pdf');
  ok(fs.existsSync(dest), 'copió el PDF del catálogo a la carpeta con el nombre correcto');
  ok(fs.readFileSync(dest).toString().includes('mundialista ya armado'), 'el PDF copiado es el del catálogo (contenido)');
  ok(Date.now() - fs.statSync(dest).mtimeMs < 60000, 'la copia queda con fecha ACTUAL (no la vieja del fuente)');
  ok(calls.mark.includes('uuid-cat-1'), 'marcó procesado el pedido de catálogo');
  ok(calls.downloads.length === downloadsBefore, 'NO bajó nada del bucket para el catálogo');
  ok(calls.remove.length === removeBefore, 'NO tocó el bucket (no hay nada que borrar)');
  const newReady = events.slice(eventsBefore).filter((e) => e.ch === 'intake:dobble-order-ready');
  ok(newReady.length === 0, 'NO emitió order-ready para el catálogo (no pasa por el renderer)');
  ok(calls.mark.length === markBefore2 + 1, 'marcó exactamente 1 (el de catálogo)');

  // Catálogo sin PDF mapeado → NO marca (se reintenta).
  const CAT_SINMAPA = { ...CATALOGO, id: 'uuid-cat-2', numero_presupuesto: '778', mazo_id: 99 };
  pending = [CAT_SINMAPA];
  const markBefore3 = calls.mark.length;
  await service.pollNow();
  ok(!fs.existsSync(path.join(OUT, 'PR-778 - Mundialista.pdf')), 'sin PDF mapeado no copia nada');
  ok(calls.mark.length === markBefore3, 'sin PDF mapeado NO marca procesado (se reintenta)');

  // ============ FASE C: config del ESPEJO/ROTACIÓN del dorso ============
  // La ubicación del dorso del combo automático es self-service: la config trae
  // dobbleBackMirror ('x' = "libro", default) y dobbleBackRotate180 (false), y
  // los sanea. Probamos el config-store REAL (bypass del mock).
  console.log('# C) config del espejo/rotación del dorso (config-store real)');
  bypassConfigMock = true;
  const realCfg = require('../config-store.cjs');
  bypassConfigMock = false;
  ok(realCfg.DEFAULTS.dobbleBackMirror === 'x', "default dobbleBackMirror = 'x' (libro / lado largo)");
  ok(realCfg.DEFAULTS.dobbleBackRotate180 === false, 'default dobbleBackRotate180 = false');
  const savedY = realCfg.save({ dobbleBackMirror: 'y', dobbleBackRotate180: true });
  ok(savedY.dobbleBackMirror === 'y' && savedY.dobbleBackRotate180 === true, "guarda 'y' + rotar=true (volteo por lado corto)");
  ok(realCfg.load().dobbleBackMirror === 'y', 'persiste el espejo elegido');
  const savedBad = realCfg.save({ dobbleBackMirror: 'zzz', dobbleBackRotate180: 0 });
  ok(savedBad.dobbleBackMirror === 'x', "saneo: espejo inválido → 'x'");
  ok(savedBad.dobbleBackRotate180 === false, 'saneo: rotar 0 → false');

  finish();
}

function finish() {
  Module._load = origLoad;
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  console.log(`\n==== ${pass} OK, ${fail} FALLOS ====`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FALLO:', e); process.exit(1); });
