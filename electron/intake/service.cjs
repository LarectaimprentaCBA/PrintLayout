// Servicio de "entrada automática" de pedidos de fotos (proceso main).
//
// Responsabilidad del MAIN: red (Supabase), descarga de fotos a una carpeta
// temporal, marcar el pedido como procesado y limpiar el bucket. NO arma las
// imágenes (eso necesita canvas/face-api y vive en el renderer): cuando un
// pedido está descargado, emite `intake:order-ready` al renderer, que arma el
// job y avisa de vuelta con `intake:order-built`.
//
// Flujo: poll → bajar fotos a temp → emitir order-ready → (el renderer arma y
// abre el/los job) → order-built → marcar procesado + borrar del bucket + temp.
// Solo se marca procesado DESPUÉS de confirmar el armado, así un cierre a mitad
// reintenta en el próximo poll.

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const configStore = require('./config-store.cjs');
const supabase = require('./supabase.cjs');

let win = null;
let timer = null;
let busy = false;
// id → { sentAt, paths: [objectPath], tmpDir }. Evita reenviar un pedido que ya
// mandamos al renderer y todavía no confirmó. Se auto-expira (STALE_MS) por si
// el evento se perdió (p.ej. ventana recargada) para que se reintente.
const inFlight = new Map();

const INITIAL_DELAY_MS = 4000; // dar tiempo a que el renderer monte y suscriba
const STALE_MS = 5 * 60 * 1000;

function emit(channel, payload) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  } catch (_) {
    /* ventana cerrada: ignorar */
  }
}

function log(message, level = 'info') {
  emit('intake:log', { ts: new Date().toISOString(), level, message });
}

function status(patch) {
  emit('intake:status', { busy, ...(patch || {}) });
}

function getConfig() {
  return configStore.load();
}

function setConfig(patch) {
  const cfg = configStore.save(patch);
  reschedule(cfg);
  return cfg;
}

function setActive(activo) {
  return setConfig({ activo: !!activo });
}

function isLaRecta() {
  return configStore.isLaRecta();
}

// Raíz de la carpeta temporal donde bajamos las fotos. Usa outputDir si está
// configurada; si no, userData/intake.
function tmpRoot(cfg) {
  const base = cfg.outputDir && cfg.outputDir.trim()
    ? cfg.outputDir.trim()
    : path.join(app.getPath('userData'), 'intake');
  return path.join(base, '.intake-tmp');
}

function parseItems(order) {
  let items = order && order.items;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch (_) {
      items = [];
    }
  }
  return Array.isArray(items) ? items : [];
}

// Baja todas las fotos de un pedido a temp y emite order-ready. Registra el
// pedido en inFlight con sus paths para poder borrarlos al confirmar.
async function processOrder(cfg, order) {
  const items = parseItems(order);
  const orderDir = path.join(tmpRoot(cfg), String(order.id));
  fs.mkdirSync(orderDir, { recursive: true });

  const downloaded = new Map(); // objectPath → localPath (dedup)
  const allPaths = [];
  const outItems = [];

  for (const item of items) {
    const fotos = Array.isArray(item?.fotos) ? item.fotos : [];
    const outFotos = [];
    for (const foto of fotos) {
      const objectPath = foto?.path;
      if (!objectPath) continue;
      let localPath = downloaded.get(objectPath);
      if (!localPath) {
        const buf = await supabase.downloadObject(cfg, objectPath);
        const base = path.basename(objectPath);
        localPath = path.join(orderDir, base);
        fs.writeFileSync(localPath, buf);
        downloaded.set(objectPath, localPath);
        allPaths.push(objectPath);
      }
      outFotos.push({
        path: objectPath,
        localPath,
        nombre: foto?.nombre || path.basename(objectPath),
        copias: Math.max(1, Math.floor(Number(foto?.copias) || 1)),
      });
    }
    outItems.push({ tamano: item?.tamano || null, fotos: outFotos });
  }

  inFlight.set(String(order.id), { sentAt: Date.now(), paths: allPaths, tmpDir: orderDir });
  emit('intake:order-ready', {
    id: order.id,
    numero_presupuesto: order.numero_presupuesto || null,
    created_at: order.created_at || null,
    items: outItems,
  });
  log(`Pedido ${order.numero_presupuesto || order.id}: ${downloaded.size} foto(s) bajada(s), enviado a armar.`);
}

// Un ciclo de poll. `manual` ignora el flag activo (botón "Buscar ahora").
async function tick(manual = false) {
  if (busy) return { ok: false, error: 'Ya hay un ciclo en curso.' };
  const cfg = getConfig();
  // Solo la PC de La Recta baja pedidos (clave + flag presentes).
  if (!configStore.isLaRecta(cfg)) {
    return { ok: false, error: 'Esta PC no está en modo La Recta.' };
  }
  if (!manual && !cfg.activo) return { ok: false, error: 'Servicio en pausa.' };
  if (!cfg.supabaseUrl || !cfg.serviceKey) {
    log('Falta URL o service key.', 'warn');
    return { ok: false, error: 'Falta URL o service key.' };
  }

  busy = true;
  status({ activo: cfg.activo, pollSeconds: cfg.pollSeconds });
  let found = 0;
  try {
    const orders = await supabase.listPendingOrders(cfg);
    const now = Date.now();
    for (const order of orders) {
      const id = String(order.id);
      const entry = inFlight.get(id);
      if (entry && now - entry.sentAt < STALE_MS) continue; // ya en vuelo
      found += 1;
      try {
        await processOrder(cfg, order);
      } catch (err) {
        log(`Error bajando el pedido ${order.numero_presupuesto || id}: ${err.message}`, 'error');
      }
    }
    if (orders.length === 0) log('Sin pedidos pendientes.');
    return { ok: true, found, pending: orders.length };
  } catch (err) {
    log(`Error consultando pedidos: ${err.message}`, 'error');
    return { ok: false, error: err.message };
  } finally {
    busy = false;
    status({ activo: cfg.activo, pollSeconds: cfg.pollSeconds, lastRun: new Date().toISOString() });
  }
}

function reschedule(cfg) {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const c = cfg || getConfig();
  const laRecta = configStore.isLaRecta(c);
  status({ activo: c.activo, pollSeconds: c.pollSeconds, laRecta });
  if (!laRecta) {
    // Sin modo La Recta el servicio queda completamente inerte.
    return;
  }
  if (!c.activo) {
    log('Servicio en pausa.');
    return;
  }
  log(`Servicio activo (cada ${c.pollSeconds}s).`);
  setTimeout(() => { tick(false).catch(() => {}); }, INITIAL_DELAY_MS);
  timer = setInterval(() => { tick(false).catch(() => {}); }, c.pollSeconds * 1000);
}

function start(browserWin) {
  win = browserWin;
  const cfg = getConfig();
  status({ activo: cfg.activo, pollSeconds: cfg.pollSeconds });
  reschedule(cfg);
}

async function pollNow() {
  return tick(true);
}

async function testConnection() {
  const cfg = getConfig();
  if (!cfg.supabaseUrl || !cfg.serviceKey) {
    return { ok: false, error: 'Falta URL o service key.' };
  }
  try {
    const orders = await supabase.listPendingOrders(cfg, { limit: 1 });
    return { ok: true, pending: orders.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Lee los bytes de una foto ya descargada (para que el renderer la procese).
// Valida que el path esté dentro de la carpeta temporal (no leer cualquier
// archivo del disco desde el renderer).
async function readFile(localPath) {
  try {
    if (!localPath) return null;
    const root = path.resolve(tmpRoot(getConfig()));
    const resolved = path.resolve(localPath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      log(`readFile rechazado (fuera de temp): ${localPath}`, 'warn');
      return null;
    }
    if (!fs.existsSync(resolved)) return null;
    return fs.readFileSync(resolved); // Buffer → Uint8Array en el renderer
  } catch (err) {
    log(`readFile error: ${err.message}`, 'error');
    return null;
  }
}

// El renderer confirma el resultado del armado:
//   { id, ok: true }  → marcar procesado + borrar fotos del bucket + temp.
//   { id, ok: false } → no marcar (se reintenta), liberar el in-flight.
async function orderBuilt(payload) {
  const id = payload && payload.id != null ? String(payload.id) : null;
  if (!id) return { ok: false, error: 'Falta id.' };
  const entry = inFlight.get(id);

  if (payload.ok === false) {
    inFlight.delete(id);
    log(`El armado del pedido ${id} falló: ${payload.error || 'sin detalle'}. Se reintentará.`, 'error');
    return { ok: true };
  }

  const cfg = getConfig();
  try {
    await supabase.markProcessed(cfg, id);
  } catch (err) {
    log(`No se pudo marcar procesado el pedido ${id}: ${err.message}`, 'error');
    return { ok: false, error: err.message };
  }
  // Best-effort: borrar fotos del bucket + temp local.
  try {
    if (entry?.paths?.length) await supabase.removeObjects(cfg, entry.paths);
  } catch (err) {
    log(`No se pudieron borrar las fotos del bucket (pedido ${id}): ${err.message}`, 'warn');
  }
  try {
    if (entry?.tmpDir) fs.rmSync(entry.tmpDir, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
  inFlight.delete(id);
  log(`Pedido ${id} procesado y limpiado.`);
  return { ok: true };
}

// Publica/quita el catálogo de planchas oficiales (solo modo La Recta).
async function publishCatalog(rows) {
  const cfg = getConfig();
  if (!configStore.isLaRecta(cfg)) return { ok: false, error: 'Esta PC no está en modo La Recta.' };
  try {
    await supabase.upsertCatalog(cfg, rows);
    log(`Catálogo publicado (${Array.isArray(rows) ? rows.length : 0} fila/s).`);
    return { ok: true, count: Array.isArray(rows) ? rows.length : 0 };
  } catch (err) {
    log(`Error publicando catálogo: ${err.message}`, 'error');
    return { ok: false, error: err.message };
  }
}

async function publishConfig(clave, valor) {
  const cfg = getConfig();
  if (!configStore.isLaRecta(cfg)) return { ok: false, error: 'Esta PC no está en modo La Recta.' };
  try {
    await supabase.upsertConfig(cfg, clave, valor);
    log(`Config publicada: ${clave}.`);
    return { ok: true };
  } catch (err) {
    log(`Error publicando config ${clave}: ${err.message}`, 'error');
    return { ok: false, error: err.message };
  }
}

module.exports = {
  start,
  getConfig,
  setConfig,
  setActive,
  isLaRecta,
  pollNow,
  testConnection,
  readFile,
  orderBuilt,
  publishCatalog,
  publishConfig,
};
