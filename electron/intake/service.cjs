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
const savePdf = require('./save-pdf.cjs');

let win = null;
let timer = null;
let busy = false;
let busyDobble = false;
let busyRotulos = false;
// id → { sentAt, paths: [objectPath], tmpDir }. Evita reenviar un pedido que ya
// mandamos al renderer y todavía no confirmó. Se auto-expira (STALE_MS) por si
// el evento se perdió (p.ej. ventana recargada) para que se reintente.
const inFlight = new Map();
// Igual que inFlight pero para pedidos Dobble (tabla pedido_dobble).
const inFlightDobble = new Map();
// Igual que inFlight pero para pedidos de Rótulos (tabla pedido_rotulo). No hay
// paths de bucket (receta inline): solo { sentAt, numero }.
const inFlightRotulos = new Map();

const INITIAL_DELAY_MS = 4000; // dar tiempo a que el renderer monte y suscriba
const STALE_MS = 5 * 60 * 1000;

// --- Reintentos con backoff (evita el loop de re-descarga infinita) ---
// Un pedido que falla siempre (foto corrupta, mazo sin PDF mapeado, etc.) no se
// marca procesado, así que sin control se reintentaría —y en fotos/dobble se
// RE-BAJARÍA todo— en cada ciclo para siempre. Llevamos un contador por id:
// tras cada fallo esperamos un backoff exponencial antes de reintentar, y tras
// MAX_ATTEMPTS el pedido queda "en error" y NO se reintenta hasta que el
// operador reconfigure (setConfig) o apriete "Buscar ahora" (pollNow).
const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 60 * 1000;      // 1 min tras el 1er fallo
const RETRY_MAX_MS = 30 * 60 * 1000;  // techo del backoff
// id → { count, nextAt, lastError, poisoned, numero }
const attempts = new Map();

// ¿Saltear este pedido en este ciclo? true si está "en error" (poisoned) o si
// todavía no venció su backoff.
function shouldSkip(id, now) {
  const a = attempts.get(id);
  if (!a) return false;
  if (a.poisoned) return true;
  return now < a.nextAt;
}

// Registra un fallo del pedido: sube el contador, programa el próximo intento
// (backoff) o lo marca "en error" tras MAX_ATTEMPTS (log una sola vez).
function recordFailure(id, numero, error) {
  const a = attempts.get(id) || { count: 0, nextAt: 0, poisoned: false, numero: null };
  a.count += 1;
  a.lastError = error;
  if (numero != null) a.numero = numero;
  if (a.count >= MAX_ATTEMPTS) {
    if (!a.poisoned) {
      a.poisoned = true;
      log(`Pedido ${a.numero || id} quedó EN ERROR tras ${a.count} intentos: ${error}. `
        + 'No se reintenta hasta reconfigurar o apretar "Buscar ahora".', 'error');
    }
  } else {
    const backoff = Math.min(RETRY_BASE_MS * (2 ** (a.count - 1)), RETRY_MAX_MS);
    a.nextAt = Date.now() + backoff;
    log(`Pedido ${a.numero || id}: intento ${a.count}/${MAX_ATTEMPTS} falló (${error}). `
      + `Reintenta en ${Math.round(backoff / 1000)}s.`, 'warn');
  }
  attempts.set(id, a);
  emitErrored();
}

// Un pedido salió bien: se olvida su historial de fallos.
function recordSuccess(id) {
  if (attempts.delete(id)) emitErrored();
}

// Da una chance limpia a TODOS los pedidos (reconfiguración o "Buscar ahora").
function resetAttempts() {
  if (attempts.size) {
    attempts.clear();
    emitErrored();
  }
}

// Publica al panel la lista de pedidos "en error" (para mostrarlos, no en el log).
function emitErrored() {
  const errored = [];
  for (const [id, a] of attempts) {
    if (a.poisoned) errored.push({ id, numero: a.numero, error: a.lastError });
  }
  status({ errored });
}

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
  // El operador cambió algo (p.ej. mapeó un mazo→PDF que faltaba): dale una
  // chance limpia a los pedidos que estaban en backoff o en error.
  resetAttempts();
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
        // Encuadre elegido por el cliente en el editor web (fit/focalPoint/
        // rotación). null si el pedido no lo trae; buildOrderJob lo aplica.
        encuadre: foto?.encuadre ?? null,
      });
    }
    outItems.push({ tamano: item?.tamano || null, fotos: outFotos });
  }

  inFlight.set(String(order.id), { sentAt: Date.now(), paths: allPaths, tmpDir: orderDir, numero: order.numero_presupuesto || null });
  emit('intake:order-ready', {
    id: order.id,
    numero_presupuesto: order.numero_presupuesto || null,
    created_at: order.created_at || null,
    items: outItems,
  });
  log(`Pedido ${order.numero_presupuesto || order.id}: ${downloaded.size} foto(s) bajada(s), enviado a armar.`);
}

// ---- Pedidos Dobble (exportador TOTALMENTE automático) ----
// Baja <id>/receta.json y —si hay— <id>/caja.jpg del bucket `dobble` a temp y
// emite `intake:dobble-order-ready`. El renderer posa el combo, exporta el PDF
// doble faz, lo guarda SOLO en la carpeta (sin diálogo) y confirma con
// `intake:dobble-order-built` → recién ahí marcamos procesado y limpiamos.
async function processDobbleOrder(cfg, order) {
  const id = String(order.id);
  // Bajo la misma raíz temporal que fotos (subcarpeta 'dobble') para que
  // `readFile` (validación por prefijo) acepte estos paths.
  const orderDir = path.join(tmpRoot(cfg), 'dobble', id);
  fs.mkdirSync(orderDir, { recursive: true });
  const paths = [];

  const recetaObj = order.receta_path;
  if (!recetaObj) throw new Error('El pedido no tiene receta_path.');
  const recetaBuf = await supabase.downloadDobbleObject(cfg, recetaObj);
  const recetaLocal = path.join(orderDir, 'receta.json');
  fs.writeFileSync(recetaLocal, recetaBuf);
  paths.push(recetaObj);

  // caja.jpg es opcional. Si falla la bajada, seguimos sin caja (queda en blanco).
  let cajaLocal = null;
  if (order.caja_path) {
    try {
      const cajaBuf = await supabase.downloadDobbleObject(cfg, order.caja_path);
      cajaLocal = path.join(orderDir, path.basename(order.caja_path));
      fs.writeFileSync(cajaLocal, cajaBuf);
      paths.push(order.caja_path);
    } catch (err) {
      log(`Pedido Dobble ${order.numero_presupuesto || id}: no se pudo bajar la caja (${err.message}); sigo sin caja.`, 'warn');
      cajaLocal = null;
    }
  }

  inFlightDobble.set(id, { sentAt: Date.now(), paths, tmpDir: orderDir, numero: order.numero_presupuesto || null });
  emit('intake:dobble-order-ready', {
    id: order.id,
    numero_presupuesto: order.numero_presupuesto || null,
    nombre_mazo: order.nombre_mazo || null,
    // La caja de PrintLayout es doble faz por naturaleza; default true salvo
    // que el pedido lo diga explícitamente false.
    doble_faz: order.doble_faz !== false,
    recetaPath: recetaLocal,
    cajaPath: cajaLocal,
  });
  log(`Pedido Dobble ${order.numero_presupuesto || id}: receta${cajaLocal ? ' + caja' : ''} bajada, enviado a armar.`);
}

// Pedido de CATÁLOGO (mazo NUESTRO, ej. el mundialista): el PDF ya está armado.
// NO baja receta/caja ni pasa por el renderer: copia el PDF local mapeado
// (mazo_id → archivo) a la carpeta de salida con el nombre
// "PR-<presupuesto> - <mazo>.pdf" y marca procesado en el acto. El mapa lo
// configura Mariano en el panel de Pedidos (dobbleMazoPdfMap).
async function processCatalogoOrder(cfg, order) {
  const id = String(order.id);
  const outDir = (cfg.dobbleOutputDir || '').trim();
  if (!outDir) throw new Error('No hay carpeta de salida configurada.');
  const map = (cfg.dobbleMazoPdfMap && typeof cfg.dobbleMazoPdfMap === 'object') ? cfg.dobbleMazoPdfMap : {};
  const src = order.mazo_id != null ? map[String(order.mazo_id)] : null;
  if (!src) throw new Error(`No hay PDF configurado para el mazo "${order.mazo_id}" (mapá mazo→PDF en Pedidos).`);
  if (!fs.existsSync(src)) throw new Error(`El PDF configurado no existe: ${src}`);

  const dest = path.join(outDir, savePdf.dobblePdfFileName(order.numero_presupuesto, order.nombre_mazo));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  // copyFileSync hereda la fecha del PDF original: la piso con "ahora" para que
  // el archivo generado aparezca como nuevo (sino, ordenado por fecha, queda
  // mezclado con los viejos y parece que no se generó).
  try { const stamp = new Date(); fs.utimesSync(dest, stamp, stamp); } catch (_) { /* best-effort */ }
  await supabase.markProcessedDobble(cfg, id);
  log(`Pedido de catálogo ${order.numero_presupuesto || id}: copiado "${path.basename(dest)}" y marcado procesado.`);
}

// Un ciclo de poll de pedidos Dobble. Igual que `tick` pero contra pedido_dobble
// y gateado por `dobbleActive` (toggle propio). `manual` ignora el flag activo.
async function tickDobble(manual = false) {
  if (busyDobble) return { ok: false, error: 'Ya hay un ciclo Dobble en curso.' };
  const cfg = getConfig();
  if (!configStore.isLaRecta(cfg)) return { ok: false, error: 'Esta PC no está en modo La Recta.' };
  if (!manual && !cfg.activo) return { ok: false, error: 'Servicio en pausa.' };
  if (!cfg.dobbleActive) return { ok: false, skipped: true };
  if (!cfg.supabaseUrl || !cfg.serviceKey) return { ok: false, error: 'Falta URL o service key.' };

  busyDobble = true;
  let found = 0;
  try {
    const orders = await supabase.listPendingDobble(cfg);
    const now = Date.now();
    for (const order of orders) {
      const id = String(order.id);
      // Mazo NUESTRO (origen 'catalogo'): copiar el PDF ya armado, sin bajar nada
      // ni renderizar. Se resuelve entero acá y se marca procesado en el acto.
      if (order.origen === 'catalogo') {
        if (shouldSkip(id, now)) continue; // en error o esperando backoff
        found += 1;
        try {
          await processCatalogoOrder(cfg, order);
          recordSuccess(id);
        } catch (err) {
          recordFailure(id, order.numero_presupuesto, err.message);
          log(`Error copiando el pedido de catálogo ${order.numero_presupuesto || id}: ${err.message}`, 'error');
        }
        continue;
      }
      // Mazo del cliente (origen 'propio' u otro): generar sobre la plantilla
      // combo (baja receta/caja → renderer posa/exporta → confirma).
      if (shouldSkip(id, now)) continue; // en error o esperando backoff
      const entry = inFlightDobble.get(id);
      if (entry && now - entry.sentAt < STALE_MS) continue; // ya en vuelo
      found += 1;
      try {
        await processDobbleOrder(cfg, order);
      } catch (err) {
        recordFailure(id, order.numero_presupuesto, err.message);
        log(`Error bajando el pedido Dobble ${order.numero_presupuesto || id}: ${err.message}`, 'error');
      }
    }
    if (orders.length > 0) log(`${orders.length} pedido(s) Dobble pendiente(s).`);
    return { ok: true, found, pending: orders.length };
  } catch (err) {
    log(`Error consultando pedidos Dobble: ${err.message}`, 'error');
    return { ok: false, error: err.message };
  } finally {
    busyDobble = false;
  }
}

// ---- Pedidos de Rótulos (exportador automático, receta INLINE) ----
// MÁS SIMPLE que Dobble: el cliente no sube archivos → no hay que bajar nada del
// bucket. La receta viaja en la propia fila; el arte y la fuente ya están en el
// catálogo local/compartido (publicados desde esta PC). Emitimos
// `intake:rotulo-order-ready` con la fila; el renderer mapea a la spec, genera
// el PDF con el MOTOR PROBADO (buildRotulosPdfBytes), lo guarda en la carpeta y
// confirma con `intake:rotulo-order-built` → recién ahí marcamos procesado.
async function processRotuloOrder(cfg, order) {
  const id = String(order.id);
  inFlightRotulos.set(id, { sentAt: Date.now(), numero: order.numero_presupuesto || null });
  emit('intake:rotulo-order-ready', {
    id: order.id,
    numero_presupuesto: order.numero_presupuesto || null,
    plancha_id: order.plancha_id || null,
    modelo_id: order.modelo_id || null,
    nombre: order.nombre || '',
    tipografia_id: order.tipografia_id || null,
    color: order.color || null,
    overrides: order.overrides ?? null,
  });
  log(`Pedido de rótulos ${order.numero_presupuesto || id}: enviado a armar.`);
}

// Un ciclo de poll de pedidos de Rótulos. Molde de tickDobble pero SIN descarga
// de bucket; gateado por `rotulosActive` (toggle propio). `manual` ignora el
// flag activo.
async function tickRotulos(manual = false) {
  if (busyRotulos) return { ok: false, error: 'Ya hay un ciclo de rótulos en curso.' };
  const cfg = getConfig();
  if (!configStore.isLaRecta(cfg)) return { ok: false, error: 'Esta PC no está en modo La Recta.' };
  if (!manual && !cfg.activo) return { ok: false, error: 'Servicio en pausa.' };
  if (!cfg.rotulosActive) return { ok: false, skipped: true };
  if (!cfg.supabaseUrl || !cfg.serviceKey) return { ok: false, error: 'Falta URL o service key.' };

  busyRotulos = true;
  let found = 0;
  try {
    const orders = await supabase.listPendingRotulos(cfg);
    const now = Date.now();
    for (const order of orders) {
      const id = String(order.id);
      if (shouldSkip(id, now)) continue; // en error o esperando backoff
      const entry = inFlightRotulos.get(id);
      if (entry && now - entry.sentAt < STALE_MS) continue; // ya en vuelo
      found += 1;
      try {
        await processRotuloOrder(cfg, order);
      } catch (err) {
        recordFailure(id, order.numero_presupuesto, err.message);
        log(`Error preparando el pedido de rótulos ${order.numero_presupuesto || id}: ${err.message}`, 'error');
      }
    }
    if (orders.length > 0) log(`${orders.length} pedido(s) de rótulos pendiente(s).`);
    return { ok: true, found, pending: orders.length };
  } catch (err) {
    log(`Error consultando pedidos de rótulos: ${err.message}`, 'error');
    return { ok: false, error: err.message };
  } finally {
    busyRotulos = false;
  }
}

// Un ciclo completo: fotos + Dobble + Rótulos (cada uno gateado por su propio
// flag). Es lo que dispara el timer y el botón "Buscar ahora".
async function pollBoth(manual = false) {
  const photos = await tick(manual).catch((e) => ({ ok: false, error: e.message }));
  const dobble = await tickDobble(manual).catch((e) => ({ ok: false, error: e.message }));
  const rotulos = await tickRotulos(manual).catch((e) => ({ ok: false, error: e.message }));
  return {
    ok: photos.ok || dobble.ok || rotulos.ok,
    found: (photos.found || 0) + (dobble.found || 0) + (rotulos.found || 0),
    photos,
    dobble,
    rotulos,
  };
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
      if (shouldSkip(id, now)) continue; // en error o esperando backoff
      const entry = inFlight.get(id);
      if (entry && now - entry.sentAt < STALE_MS) continue; // ya en vuelo
      found += 1;
      try {
        await processOrder(cfg, order);
      } catch (err) {
        recordFailure(id, order.numero_presupuesto, err.message);
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
  setTimeout(() => { pollBoth(false).catch(() => {}); }, INITIAL_DELAY_MS);
  timer = setInterval(() => { pollBoth(false).catch(() => {}); }, c.pollSeconds * 1000);
}

function start(browserWin) {
  win = browserWin;
  const cfg = getConfig();
  status({ activo: cfg.activo, pollSeconds: cfg.pollSeconds });
  reschedule(cfg);
}

async function pollNow() {
  // "Buscar ahora" = reintento manual: limpia backoff/errores para que los
  // pedidos que estaban esperando o "en error" se reintenten en el acto.
  resetAttempts();
  return pollBoth(true);
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
    recordFailure(id, entry?.numero, payload.error || 'sin detalle');
    log(`El armado del pedido ${id} falló: ${payload.error || 'sin detalle'}.`, 'error');
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
  recordSuccess(id);
  log(`Pedido ${id} procesado y limpiado.`);
  return { ok: true };
}

// El renderer confirma el resultado del armado del pedido Dobble:
//   { id, ok: true }  → marcar procesado + borrar receta/caja del bucket + temp.
//   { id, ok: false } → no marcar (se reintenta), liberar el in-flight.
async function dobbleOrderBuilt(payload) {
  const id = payload && payload.id != null ? String(payload.id) : null;
  if (!id) return { ok: false, error: 'Falta id.' };
  const entry = inFlightDobble.get(id);

  if (payload.ok === false) {
    inFlightDobble.delete(id);
    recordFailure(id, entry?.numero, payload.error || 'sin detalle');
    log(`El armado del pedido Dobble ${id} falló: ${payload.error || 'sin detalle'}.`, 'error');
    return { ok: true };
  }

  const cfg = getConfig();
  try {
    await supabase.markProcessedDobble(cfg, id);
  } catch (err) {
    log(`No se pudo marcar procesado el pedido Dobble ${id}: ${err.message}`, 'error');
    return { ok: false, error: err.message };
  }
  // Best-effort: borrar receta/caja del bucket + temp local.
  try {
    if (entry?.paths?.length) await supabase.removeDobbleObjects(cfg, entry.paths);
  } catch (err) {
    log(`No se pudieron borrar los archivos del bucket dobble (pedido ${id}): ${err.message}`, 'warn');
  }
  try {
    if (entry?.tmpDir) fs.rmSync(entry.tmpDir, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
  inFlightDobble.delete(id);
  recordSuccess(id);
  log(`Pedido Dobble ${id} procesado y limpiado.`);
  return { ok: true };
}

// El renderer confirma el resultado del armado del pedido de Rótulos:
//   { id, ok: true }  → marcar procesado (no hay bucket ni temp que limpiar).
//   { id, ok: false } → no marcar (se reintenta con backoff), liberar in-flight.
async function rotuloOrderBuilt(payload) {
  const id = payload && payload.id != null ? String(payload.id) : null;
  if (!id) return { ok: false, error: 'Falta id.' };
  const entry = inFlightRotulos.get(id);

  if (payload.ok === false) {
    inFlightRotulos.delete(id);
    recordFailure(id, entry?.numero, payload.error || 'sin detalle');
    log(`El armado del pedido de rótulos ${id} falló: ${payload.error || 'sin detalle'}.`, 'error');
    return { ok: true };
  }

  const cfg = getConfig();
  try {
    await supabase.markProcessedRotulos(cfg, id);
  } catch (err) {
    log(`No se pudo marcar procesado el pedido de rótulos ${id}: ${err.message}`, 'error');
    return { ok: false, error: err.message };
  }
  inFlightRotulos.delete(id);
  recordSuccess(id);
  log(`Pedido de rótulos ${id} procesado.`);
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
  dobbleOrderBuilt,
  rotuloOrderBuilt,
  publishCatalog,
  publishConfig,
};
