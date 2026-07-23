// Servidor de corte QR (proceso MAIN) — nuestra "File Center", reemplazo del
// QRFileCut.exe chino.
//
// Protocolo capturado en vivo (2026-07-13, proxy TCP) del corte por QR del
// plotter SKYCUT:
//   1) Nos conectamos al plotter (cliente TCP) en plotterIP:plotterPort.
//   2) ⚠️ NO mandamos saludo. El original mandaba "BD:19,10;" y eso dispara un
//      TEST DE CUCHILLA (corte en vacío) al conectar → puede arruinar el plotter.
//      Verificado: SIN saludo el plotter no se mueve e IGUAL sirve el corte.
//   3) Mandamos un espacio (0x20) cada ~1s (latido, mantiene viva la conexión).
//   4) Cuando el operario escanea un QR, el plotter manda "QROK:<nombre>;".
//   5) Leemos <nombre>.plt de la carpeta de cortes y escribimos sus bytes TAL
//      CUAL en el socket (el .plt ya termina en @ @, sin framing extra).
//   6) Reconectamos solo si se cae (backoff).
//
// Coexistencia con el envío directo (send_to_plotter.py) y con el portero/relay
// (cortes de otras PC): todos pasan por un CANDADO ÚNICO (acquirePlotter/
// releasePlotter). Mientras alguien lo tiene, este server suelta el socket y NO
// reconecta; al liberar el último de la cola, se reconecta solo. Así nunca hay
// dos conexiones peleando por el plotter.

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const configStore = require('./config-store.cjs');

let win = null;
let sock = null;
let hb = null;              // interval del latido (0x20 cada 1s)
let reconnectTimer = null;
let connected = false;
let reconnectDelay = 0;     // backoff actual (ms)
let lastServed = null;      // { name, bytes, ts }
let lastError = null;

// ---- Candado único del plotter (:8080) --------------------------------------
// El plotter es un dispositivo serie: solo UN productor puede escribirle a la
// vez (dos conexiones se corromperían). Por él pasan los 3 productores:
//   (a) server QR (dueño por defecto: mantiene la conexión y sirve por QR),
//   (b) plotter:send-cut local (envío directo),
//   (c) cada conexión del relay (cortes de otras PC).
// Mientras alguien tiene el candado, el server QR SUELTA el socket y NO
// reconecta; al liberar el último de la cola, el server QR se reconecta solo.
// currentToken = objeto único del dueño actual (null = libre). La pausa se
// SOSTIENE durante todo el drenado de la cola (no se reconecta entre jobs).
let currentToken = null;
const waiters = [];        // [{ token, resolve }]
let lockWatchdog = null;   // backstop si un dueño no libera
let settleTimer = null;    // espera de asentamiento en las transiciones de dueño
// Estado del relay (lo empuja relay.cjs) para publicarlo en el mismo status.
let relayState = { relayListening: false, relayPort: null, relayClient: null, relayQueue: 0 };

const HEARTBEAT_MS = 1000;
const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 30000;
// Tope absoluto que un productor puede retener el plotter (backstop del
// watchdog). Un poco mayor que el tope por-cliente del relay (~3 min).
const LOCK_ABSOLUTE_MAX_MS = 3 * 60 * 1000 + 20000;

function emit(channel, payload) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  } catch (_) {
    /* ventana cerrada: ignorar */
  }
}

function log(message, level = 'info') {
  emit('qrcut:log', { ts: new Date().toISOString(), level, message });
}

// Lo usa relay.cjs para loguear en el mismo panel (canal qrcut:log).
function emitLog(message, level = 'info') {
  log(message, level);
}

function snapshot(extra) {
  const cfg = configStore.load();
  return {
    connected,
    // `paused` = hay un productor con el candado (compat con el panel viejo).
    paused: !!currentToken,
    lockOwner: currentToken ? currentToken.owner : null,
    plotterQueue: waiters.length,
    activo: cfg.activo,
    plotterIP: cfg.plotterIP,
    plotterPort: cfg.plotterPort,
    cortesDir: cfg.cortesDir,
    lastServed,
    lastError,
    ...relayState,
    ...(extra || {}),
  };
}

function status(extra) {
  emit('qrcut:status', snapshot(extra));
}

function getStatus() {
  return snapshot();
}

// relay.cjs empuja su estado; se publica en el mismo status del panel.
function setRelayStatus(patch) {
  relayState = { ...relayState, ...(patch || {}) };
  status();
}

// Cierra socket + latido + reconexión pendiente, sin cambiar `paused`/`activo`.
function teardown() {
  if (hb) { clearInterval(hb); hb = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (sock) {
    try { sock.removeAllListeners(); sock.destroy(); } catch (_) { /* ignore */ }
    sock = null;
  }
  connected = false;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectDelay = reconnectDelay
    ? Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
    : RECONNECT_MIN_MS;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
}

function connect() {
  const cfg = configStore.load();
  if (!cfg.activo) { status(); return; }
  if (currentToken) return; // el candado está tomado: no competimos por el puerto

  teardown();
  const { plotterIP, plotterPort } = cfg;
  log(`Conectando al plotter ${plotterIP}:${plotterPort} …`);

  const s = net.connect(plotterPort, plotterIP);
  sock = s;
  let buf = '';

  s.on('connect', () => {
    if (s !== sock) return; // socket viejo (reemplazado): ignorar
    connected = true;
    lastError = null;
    reconnectDelay = 0; // conexión OK → reset del backoff
    // SIN saludo (crítico: no disparar el test de cuchilla).
    log('Conectado al plotter (sin saludo, no mueve la cuchilla).');
    hb = setInterval(() => {
      if (s && !s.destroyed) {
        try { s.write(' '); } catch (_) { /* se cae solo en close */ }
      }
    }, HEARTBEAT_MS);
    status();
  });

  s.on('data', (d) => {
    buf += d.toString('latin1');
    let i;
    while ((i = buf.indexOf(';')) >= 0) {
      const msg = buf.slice(0, i + 1).trim();
      buf = buf.slice(i + 1);
      if (msg) handle(msg, s);
    }
  });

  s.on('close', () => {
    if (s !== sock) return; // socket viejo
    const wasConnected = connected;
    if (hb) { clearInterval(hb); hb = null; }
    connected = false;
    sock = null;
    status();
    const cfgNow = configStore.load();
    if (cfgNow.activo && !currentToken) {
      if (wasConnected) log('Conexión con el plotter cerrada. Reintentando…', 'warn');
      scheduleReconnect();
    }
  });

  s.on('error', (e) => {
    if (s !== sock) return;
    lastError = e.message;
    log(`Error de socket: ${e.message}`, 'error');
    status();
    // 'close' viene después y programa la reconexión.
  });
}

function handle(msg, s) {
  if (msg.startsWith('RCMD=')) {
    // Ack del plotter a un saludo. No mandamos saludo, así que normalmente no
    // llega; lo logueamos por si el firmware lo emite igual.
    log(`Ack del plotter: ${msg}`);
    return;
  }
  if (msg.startsWith('QROK:')) {
    const rawName = msg.slice(5).replace(/;$/, '').trim();
    const cfg = configStore.load();
    // Seguridad: el nombre viene del QR (texto arbitrario). Nos quedamos solo con
    // el nombre de archivo (sin separadores ni ".." para no leer fuera de la
    // carpeta) y forzamos que el path resuelto quede dentro de cortesDir.
    const safeName = path.basename(rawName);
    if (!safeName || safeName !== rawName) {
      log(`Pedido QR con nombre inválido: ${JSON.stringify(rawName)}`, 'warn');
      return;
    }
    const dir = path.resolve(cfg.cortesDir || '');
    const file = path.resolve(dir, `${safeName}.plt`);
    if (file !== path.join(dir, `${safeName}.plt`)) {
      log(`Pedido QR fuera de la carpeta de cortes: ${JSON.stringify(rawName)}`, 'warn');
      return;
    }
    log(`Pedido QR: "${safeName}" → ${file}`);
    fs.readFile(file, (err, bytes) => {
      if (err) {
        lastError = `No se encontró ${safeName}.plt`;
        log(`   ${safeName}.plt NO ENCONTRADO / error: ${err.code || err.message}`, 'error');
        status();
        return;
      }
      if (!s || s.destroyed || s !== sock) {
        log('   La conexión se cayó antes de servir el corte.', 'warn');
        return;
      }
      s.write(bytes, () => {
        lastServed = { name: safeName, bytes: bytes.length, ts: new Date().toISOString() };
        log(`   Servido ${bytes.length} bytes (corte enviado).`);
        status();
      });
    });
    return;
  }
  log(`Mensaje no reconocido del plotter: ${JSON.stringify(msg)}`);
}

// ---- API pública (la usa main.cjs) ----------------------------------------

function start(browserWin) {
  win = browserWin;
  const cfg = configStore.load();
  status();
  if (cfg.activo) connect();
  else log('Servidor de corte QR en pausa (destildado en config).');
}

function getConfig() {
  return configStore.load();
}

// Guarda cambios y reconecta con los nuevos datos (IP/puerto/carpeta/activo).
function setConfig(patch) {
  const cfg = configStore.save(patch);
  reconnectDelay = 0;
  if (!currentToken) clearSettle(); // cancelar reconexión-settle pendiente (sin waiter)
  teardown();
  if (cfg.activo && !currentToken) connect();
  else status();
  return cfg;
}

// Fuerza una reconexión inmediata (botón "Reconectar" del panel).
function reconnectNow() {
  reconnectDelay = 0;
  if (!currentToken) clearSettle(); // cancelar reconexión-settle pendiente (sin waiter)
  teardown();
  const cfg = configStore.load();
  if (cfg.activo && !currentToken) { connect(); return { ok: true }; }
  status();
  if (currentToken) return { ok: false, error: 'El plotter está ocupado por un envío en curso.' };
  return { ok: false, error: 'El servidor está en pausa (activá el servidor de corte QR).' };
}

// ---- Candado del plotter ----------------------------------------------------

function clearWatchdog() {
  if (lockWatchdog) { clearTimeout(lockWatchdog); lockWatchdog = null; }
}

function armWatchdog(token) {
  clearWatchdog();
  lockWatchdog = setTimeout(() => {
    if (currentToken === token) {
      log('El candado del plotter quedó tomado demasiado tiempo; se libera a la fuerza.', 'warn');
      releasePlotter(token);
    }
  }, LOCK_ABSOLUTE_MAX_MS);
}

function clearSettle() {
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
}

// Tiempo de asentamiento del plotter (ms) en las transiciones de dueño.
function settleMs() {
  const n = Number(configStore.load().plotterSettleMs);
  if (!Number.isFinite(n)) return 1200;
  return Math.max(0, Math.min(10000, n));
}

// Otorga el candado al próximo de la cola; si no hay nadie, reconecta el server
// QR (dueño por defecto). Mantiene la pausa durante todo el drenado.
//
// SETTLE (asentamiento): tras soltar el socket del server QR (teardown), el
// plotter (un solo dueño efectivo) tarda un instante en liberar/terminar al
// anterior. Sin esperar, el nuevo productor escribe en esa ventana y el plotter
// descarta esos bytes (por eso un corte de Corel entraba recién al 2º/3º intento).
// Por eso esperamos `plotterSettleMs` ANTES de resolver el token del nuevo dueño,
// y también antes de reconectar el QR (que el latido no pise el último corte).
function pump() {
  if (currentToken) return; // dueño activo o grant en asentamiento
  const next = waiters.shift();
  if (next) {
    clearSettle();          // cancelar una reconexión-settle pendiente: hay trabajo
    currentToken = next.token;
    teardown();             // soltar el socket del server QR mientras dura el uso
    armWatchdog(next.token);
    status();
    const ms = settleMs();
    if (ms > 0) {
      settleTimer = setTimeout(() => {
        settleTimer = null;
        // El productor recién escribe ahora (el plotter ya soltó al anterior). Si
        // el token fue liberado/forzado mientras esperaba, resolver igual: el
        // dueño verá su token != currentToken y su release será no-op (o el
        // manejo de token huérfano del relay lo suelta).
        next.resolve(next.token);
      }, ms);
    } else {
      next.resolve(next.token);
    }
    return;
  }
  // Cola vacía y candado libre → el server QR vuelve a tomar el plotter, tras el
  // settle. Si mientras esperamos entra un waiter, se re-evalúa pump() (no se
  // reconecta el QR pisando el corte nuevo).
  clearSettle();
  clearWatchdog();
  const cfg = configStore.load();
  if (!cfg.activo) { status(); return; }
  const ms = settleMs();
  if (ms > 0) {
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (currentToken || waiters.length) { pump(); return; } // llegó trabajo: atenderlo
      reconnectDelay = 0;
      const c = configStore.load();
      if (c.activo) connect();
      else status();
    }, ms);
  } else {
    reconnectDelay = 0;
    connect();
  }
}

// Pide el plotter. Resuelve con un TOKEN cuando el :8080 queda libre (encola si
// está tomado). Hay que devolverlo con releasePlotter(token).
function acquirePlotter(owner = 'directo') {
  return new Promise((resolve) => {
    waiters.push({ token: { owner, at: Date.now() }, resolve });
    pump();
  });
}

// Libera el candado. Solo actúa si el token es el del dueño actual (un release
// viejo/duplicado es no-op). Pasa el turno al siguiente o reconecta el QR.
function releasePlotter(token) {
  if (!token || token !== currentToken) return;
  currentToken = null;
  clearWatchdog();
  pump();
}

// Botón "Forzar liberar / reconectar": suelta al dueño actual (si hay) y
// reconecta el server QR. La cola se drena sola si quedan pedidos legítimos.
function forcePlotterRelease() {
  if (currentToken) {
    log('Liberación forzada del plotter.', 'warn');
    const t = currentToken;
    currentToken = null;
    clearWatchdog();
    // ignorar el release del dueño viejo si llega tarde (t !== currentToken).
    void t;
    pump();
  } else {
    reconnectNow();
  }
  return { ok: true };
}

module.exports = {
  start,
  getConfig,
  setConfig,
  reconnectNow,
  getStatus,
  emitLog,
  setRelayStatus,
  acquirePlotter,
  releasePlotter,
  forcePlotterRelease,
};
