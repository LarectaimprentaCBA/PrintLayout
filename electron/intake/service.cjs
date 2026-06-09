// Servicio de "entrada automática" de pedidos de fotos (proceso main).
//
// Responsabilidad del MAIN: red (Supabase), descarga de fotos a una carpeta
// temporal, marcar el pedido como procesado y limpiar el bucket. NO arma las
// imágenes (eso necesita canvas/face-api y vive en el renderer): cuando un
// pedido está descargado, emite `intake:order-ready` al renderer, que arma el
// job y avisa de vuelta con `intake:order-built`.
//
// Este archivo (Commit 1) trae la config + el andamiaje de eventos/timer; la
// lógica de red real (poll, descarga, PATCH, DELETE) se implementa en Commit 2.

const configStore = require('./config-store.cjs');

let win = null;
let timer = null;
let busy = false;
// Pedidos ya enviados al renderer y todavía sin confirmar (para no reenviar).
const inFlight = new Set();

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
  emit('intake:status', patch || {});
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

// (Re)programa el loop según la config. En Commit 1 sólo refleja el estado;
// el tick real se conecta en Commit 2.
function reschedule(cfg) {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const c = cfg || getConfig();
  status({ activo: c.activo, pollSeconds: c.pollSeconds, busy });
  if (!c.activo) {
    log('Servicio en pausa.');
    return;
  }
  log(`Servicio activo (cada ${c.pollSeconds}s).`);
  // Commit 2: timer = setInterval(tick, c.pollSeconds * 1000) + tick inicial.
}

function start(browserWin) {
  win = browserWin;
  const cfg = getConfig();
  status({ activo: cfg.activo, pollSeconds: cfg.pollSeconds, busy: false });
  reschedule(cfg);
}

// ---- Stubs: implementados en Commit 2 (cliente Supabase + loop real) ----

async function pollNow() {
  return { ok: false, error: 'El servicio de red aún no está implementado (Commit 2).' };
}

async function testConnection() {
  return { ok: false, error: 'El servicio de red aún no está implementado (Commit 2).' };
}

// Lee los bytes de una foto ya descargada a la temporal (para que el renderer
// la procese). Commit 2 valida que el path esté dentro de la carpeta de salida.
async function readFile(_localPath) {
  return null;
}

// El renderer confirma que armó el job → marcar procesado + limpiar bucket/temp.
async function orderBuilt(_payload) {
  return { ok: false, error: 'El servicio de red aún no está implementado (Commit 2).' };
}

module.exports = {
  start,
  getConfig,
  setConfig,
  setActive,
  pollNow,
  testConnection,
  readFile,
  orderBuilt,
  // helpers expuestos para Commit 2 / tests
  _internals: { emit, log, status, inFlight, get busy() { return busy; }, set busy(v) { busy = v; } },
};
