// Portero / relay de cortes (proceso MAIN) — multiplexa el plotter desde varias
// PC.
//
// Problema: el server QR mantiene la conexión permanente al plotter :8080, lo
// que bloquea los cortes DIRECTOS de otras PC / Corel / otro software.
// Solución: esta PC (la conectada al plotter) escucha en 0.0.0.0:relayPort y
// reenvía BYTE A BYTE al plotter los cortes que le mandan los emisores externos,
// coordinando con el server QR y el envío directo local por el CANDADO ÚNICO del
// server (acquirePlotter/releasePlotter). Los emisores solo cambian su IP destino
// a esta PC (.194:8080) una vez; no migran nada.
//
// Diseño clave:
//   · Pausa PEREZOSA: en accept NO tomamos el candado; recién al PRIMER byte del
//     cliente → acquirePlotter() + abrimos conexión fresca al plotter.
//   · Pipe transparente (no interpretamos el .plt): los bytes que llegan al
//     plotter == los que mandó el emisor.
//   · No confiamos en "el cliente cerró": idle-timeout amplio (reset por byte/
//     drain en cualquier dirección) + tope absoluto. Cerramos con end().
//   · releasePlotter() SIEMPRE en un único finish() que cubre todos los caminos.

const net = require('node:net');
const configStore = require('./config-store.cjs');
const qrServer = require('./server.cjs');

let server = null;
let listening = false;
let currentPort = null;
let activeClientIp = null;   // IP del cliente que está piping ahora (o null)
let waitingCount = 0;        // clientes esperando el candado (antes del 1er byte / en cola)
const activeClients = new Set(); // sockets de cliente vivos (para forzar cierre)

const CONNECT_TIMEOUT_MS = 5000;   // timeout de connect al plotter (por intento)
const CONNECT_ATTEMPTS = 3;        // reintentos por si rechaza durante la transición
const CONNECT_RETRY_PAUSE_MS = 300; // pausa corta entre intentos
const IDLE_TIMEOUT_MS = 45000;     // sin bytes ni drain → se cierra
const ABSOLUTE_MAX_MS = 3 * 60 * 1000; // tope duro por cliente

function reportStatus() {
  qrServer.setRelayStatus({
    relayListening: listening,
    relayPort: currentPort,
    relayClient: activeClientIp,
    relayQueue: waitingCount,
  });
}

// ---- Allowlist por IP (loopback siempre; resto según CIDR) -------------------
function ipToInt(ip) {
  const p = String(ip).split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    const b = Number(part);
    if (!Number.isInteger(b) || b < 0 || b > 255) return null;
    n = (n * 256) + b;
  }
  return n >>> 0;
}

function normalizeIp(raw) {
  // IPv4-mapped IPv6: ::ffff:192.168.100.5 → 192.168.100.5
  return String(raw || '').replace(/^::ffff:/i, '');
}

function ipAllowed(rawIp, cidr) {
  const ip = normalizeIp(rawIp);
  if (ip === '127.0.0.1' || ip === '::1' || ip === '') return true; // loopback
  const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(String(cidr || '').trim());
  if (!m) return false;
  const base = ipToInt(m[1]);
  const bits = Number(m[2]);
  const ipi = ipToInt(ip);
  if (base == null || ipi == null || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~((2 ** (32 - bits)) - 1)) >>> 0;
  return (ipi & mask) === (base & mask);
}

// Abre una conexión fresca al plotter con timeout de connect + varios reintentos
// (por si el plotter rechaza la conexión momentáneamente durante la transición de
// dueño). Pausa corta entre intentos.
function openPlotter(cfg, attempt = 1) {
  return new Promise((resolve, reject) => {
    const retryOrFail = (err) => {
      if (attempt < CONNECT_ATTEMPTS) {
        setTimeout(() => { openPlotter(cfg, attempt + 1).then(resolve, reject); }, CONNECT_RETRY_PAUSE_MS);
      } else {
        reject(err);
      }
    };
    const p = net.connect({ host: cfg.plotterIP, port: cfg.plotterPort });
    let settled = false;
    const to = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { p.destroy(); } catch (_) { /* ignore */ }
      retryOrFail(new Error('timeout conectando al plotter'));
    }, CONNECT_TIMEOUT_MS);
    p.once('connect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      p.setTimeout(0);
      resolve(p);
    });
    p.once('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      try { p.destroy(); } catch (_) { /* ignore */ }
      retryOrFail(e);
    });
  });
}

// GUARDAR-Y-REENVIAR: Corel (y otros emisores) hacen "fire-and-forget" — conectan,
// mandan el .plt entero y CIERRAN enseguida, sin esperar. El modelo viejo (pipe en
// vivo) descartaba esos cortes: cerraban durante la espera del candado (~settle) y
// finish('cliente cerró') corría antes de conectar al plotter → "abre y cierra pero
// no llega el corte". Ahora BUFFERIZAMOS lo que manda el cliente; aunque cierre al
// toque, igual tomamos el plotter, volcamos TODO en orden y cerramos el envío. Si el
// cliente queda abierto (protocolo persistente), seguimos en vivo y reenviamos lo
// que responda el plotter.
const GRACE_AFTER_FLUSH_MS = 4000; // tras volcar y con el cliente cerrado, esperar esto a que el plotter corte/cierre

function handleClient(socket) {
  const cfg = configStore.load();
  const ip = normalizeIp(socket.remoteAddress);
  if (!ipAllowed(ip, cfg.relayAllowlistCidr)) {
    qrServer.emitLog(`Relay: conexión rechazada de ${ip || '¿?'} (fuera de la allowlist).`, 'warn');
    try { socket.end(); } catch (_) { /* ignore */ }
    return;
  }

  activeClients.add(socket);
  let token = null;
  let plotter = null;
  let released = false;
  let started = false;      // ya tomó el candado y conectó al plotter
  let acquiring = false;    // tomando candado + conectando (aún sin plotter)
  let clientEnded = false;  // el cliente terminó de mandar (FIN o cerró)
  let sentAny = false;      // recibimos al menos un byte del cliente
  const pending = [];       // bytes recibidos aún no escritos al plotter (buffer)
  let idleTimer = null;
  let absoluteTimer = null;
  let graceTimer = null;

  waitingCount += 1;
  reportStatus();

  const bumpIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => finish('idle-timeout'), IDLE_TIMEOUT_MS);
  };

  // ÚNICO camino de salida: cubre cierre normal, error de cualquier lado, idle y
  // tope absoluto. Nunca deja el candado tomado.
  const finish = (reason) => {
    if (released) return;
    released = true;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (absoluteTimer) { clearTimeout(absoluteTimer); absoluteTimer = null; }
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
    try { if (plotter) plotter.end(); } catch (_) { /* ignore */ }
    try { socket.end(); } catch (_) { /* ignore */ }
    activeClients.delete(socket);
    if (started) activeClientIp = null;
    else waitingCount = Math.max(0, waitingCount - 1);
    reportStatus();
    if (token) { try { qrServer.releasePlotter(token); } catch (_) { /* ignore */ } token = null; }
    qrServer.emitLog(`Relay: fin de ${ip} (${reason}).`);
  };

  const flushPending = () => {
    if (!plotter) return;
    while (pending.length) {
      const d = pending.shift();
      try { plotter.write(d); } catch (_) { /* ignore */ }
    }
  };

  // El cliente ya mandó todo y cerró (fire-and-forget): volcamos lo que quede,
  // cerramos el envío al plotter (FIN, para que corte) y esperamos una gracia
  // corta a que termine/cierre. Si no cierra, finish() igual libera el candado.
  const finishAfterFlush = () => {
    if (released || graceTimer) return;
    flushPending();
    try { if (plotter) plotter.end(); } catch (_) { /* ignore */ }
    graceTimer = setTimeout(() => finish('corte enviado'), GRACE_AFTER_FLUSH_MS);
  };

  // Toma el candado + conecta al plotter una sola vez (al primer byte). Guarda lo
  // que llegue mientras tanto en `pending` y lo vuelca al conectar.
  const ensurePlotter = async () => {
    if (acquiring || started) return;
    acquiring = true;
    try {
      token = await qrServer.acquirePlotter(`relay:${ip}`);
    } catch (e) {
      qrServer.emitLog(`Relay: no se pudo tomar el plotter para ${ip} (${e.message}).`, 'error');
      finish('sin candado');
      return;
    }
    if (released) { try { qrServer.releasePlotter(token); } catch (_) { /* ignore */ } token = null; return; }
    waitingCount = Math.max(0, waitingCount - 1);
    started = true;
    activeClientIp = ip;
    reportStatus();

    const cfg2 = configStore.load();
    try {
      plotter = await openPlotter(cfg2);
    } catch (e) {
      qrServer.emitLog(`Relay: no conecta al plotter (${e.message}).`, 'error');
      finish('plotter no conecta');
      return;
    }
    if (released) {
      try { plotter.end(); } catch (_) { /* ignore */ }
      try { qrServer.releasePlotter(token); } catch (_) { /* ignore */ }
      token = null;
      return;
    }

    qrServer.emitLog(`Relay: sirviendo corte de ${ip} → plotter ${cfg2.plotterIP}:${cfg2.plotterPort}.`);
    absoluteTimer = setTimeout(() => finish('tope absoluto'), ABSOLUTE_MAX_MS);
    plotter.on('error', (e) => { qrServer.emitLog(`Relay: error del plotter (${e.message}).`, 'error'); finish('error del plotter'); });
    plotter.on('close', () => finish('plotter cerró'));
    plotter.on('data', (d) => { bumpIdle(); try { socket.write(d); } catch (_) { /* ignore */ } });
    plotter.on('drain', bumpIdle);

    bumpIdle();
    // Volcar TODO lo bufferizado en orden. Si el cliente ya cerró (Corel), cerramos
    // el envío; si sigue abierto, seguimos en vivo (los 'data' nuevos van directo).
    if (clientEnded) finishAfterFlush();
    else flushPending();
  };

  socket.on('data', (d) => {
    bumpIdle();
    sentAny = true;
    if (plotter) { try { plotter.write(d); } catch (_) { /* ignore */ } }
    else { pending.push(d); ensurePlotter(); }
  });
  socket.on('end', () => {
    clientEnded = true;
    if (plotter) finishAfterFlush();
    // si aún estamos tomando el plotter, ensurePlotter verá clientEnded al terminar.
  });
  socket.on('error', () => {
    // Un error DESPUÉS de mandar el corte no debe descartarlo (ya lo bufferizamos).
    clientEnded = true;
    if (!sentAny && !started && !acquiring) finish('error del cliente');
    else if (plotter) finishAfterFlush();
  });
  socket.on('close', () => {
    clientEnded = true;
    // Cerró sin mandar NADA (sondeo/probe) → soltar sin tomar el plotter.
    if (!sentAny && !started && !acquiring) finish('cliente cerró');
    // Cerró después de mandar el corte (fire-and-forget) → NO abortar: volcar al
    // plotter. Si el plotter ya está, finishAfterFlush; si no, ensurePlotter lo hará.
    else if (plotter) finishAfterFlush();
  });

  // Idle-timer desde el accept: si abre y nunca manda nada ni cierra, se cierra igual.
  bumpIdle();
}

function stopServer() {
  if (server) {
    try { server.close(); } catch (_) { /* ignore */ }
    server = null;
  }
  listening = false;
}

function listen(cfg) {
  stopServer();
  currentPort = cfg.relayPort || 8080;
  server = net.createServer(handleClient);
  server.on('error', (e) => {
    listening = false;
    reportStatus();
    if (e.code === 'EADDRINUSE') {
      qrServer.emitLog(`Relay: el puerto ${currentPort} ya está en uso; no se pudo abrir el portero.`, 'error');
    } else {
      qrServer.emitLog(`Relay: error del servidor (${e.message}).`, 'error');
    }
  });
  server.listen(currentPort, '0.0.0.0', () => {
    listening = true;
    reportStatus();
    qrServer.emitLog(`Relay de cortes escuchando en 0.0.0.0:${currentPort}.`);
  });
}

// ---- API pública (main.cjs) ----------------------------------------------

function start() {
  const cfg = configStore.load();
  if (!cfg.relayActivo) {
    listening = false;
    currentPort = cfg.relayPort;
    reportStatus();
    qrServer.emitLog('Portero/relay de cortes desactivado (destildado en config).');
    return;
  }
  listen(cfg);
}

// Reaplica la config del relay tras un setConfig (activar/desactivar, puerto,
// allowlist). No toca las conexiones en curso salvo que haya que re-escuchar.
function applyConfig(cfg) {
  const c = cfg || configStore.load();
  if (!c.relayActivo) {
    stopServer();
    currentPort = c.relayPort;
    reportStatus();
    return;
  }
  // Si cambió el puerto o no estábamos escuchando, re-escuchar.
  if (!listening || currentPort !== (c.relayPort || 8080)) listen(c);
}

// Cierra el cliente activo (lo usa el botón "Forzar liberar"). Su finish()
// libera el candado.
function dropActiveClients() {
  for (const s of activeClients) {
    try { s.destroy(); } catch (_) { /* ignore */ }
  }
}

module.exports = { start, applyConfig, dropActiveClients };
