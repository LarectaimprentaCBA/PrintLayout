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
// Coexistencia con el envío directo (send_to_plotter.py, que abre su propia
// conexión al mismo :8080): antes de un envío directo el main llama a
// pauseForDirectSend() (soltamos el socket) y al terminar resumeAfterDirectSend()
// (reconectamos). Así nunca hay dos conexiones peleando por el plotter.

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const configStore = require('./config-store.cjs');

let win = null;
let sock = null;
let hb = null;              // interval del latido (0x20 cada 1s)
let reconnectTimer = null;
let connected = false;
let paused = false;         // true mientras corre un envío directo
let reconnectDelay = 0;     // backoff actual (ms)
let lastServed = null;      // { name, bytes, ts }
let lastError = null;

const HEARTBEAT_MS = 1000;
const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 30000;

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

function status(extra) {
  const cfg = configStore.load();
  emit('qrcut:status', {
    connected,
    paused,
    activo: cfg.activo,
    plotterIP: cfg.plotterIP,
    plotterPort: cfg.plotterPort,
    cortesDir: cfg.cortesDir,
    lastServed,
    lastError,
    ...(extra || {}),
  });
}

function getStatus() {
  const cfg = configStore.load();
  return {
    connected,
    paused,
    activo: cfg.activo,
    plotterIP: cfg.plotterIP,
    plotterPort: cfg.plotterPort,
    cortesDir: cfg.cortesDir,
    lastServed,
    lastError,
  };
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
  if (paused) return; // hay un envío directo en curso: no competimos por el puerto

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
    if (cfgNow.activo && !paused) {
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
  teardown();
  if (cfg.activo && !paused) connect();
  else status();
  return cfg;
}

// Fuerza una reconexión inmediata (botón "Reconectar" del panel).
function reconnectNow() {
  reconnectDelay = 0;
  teardown();
  const cfg = configStore.load();
  if (cfg.activo && !paused) { connect(); return { ok: true }; }
  status();
  return { ok: false, error: 'El servidor está en pausa (activá el servidor de corte QR).' };
}

// El main va a hacer un ENVÍO DIRECTO al plotter: soltamos el socket para no
// competir por el puerto. Se reconecta con resumeAfterDirectSend().
function pauseForDirectSend() {
  paused = true;
  teardown();
  status();
}

function resumeAfterDirectSend() {
  paused = false;
  reconnectDelay = 0;
  const cfg = configStore.load();
  if (cfg.activo) connect();
  else status();
}

module.exports = {
  start,
  getConfig,
  setConfig,
  reconnectNow,
  getStatus,
  pauseForDirectSend,
  resumeAfterDirectSend,
};
