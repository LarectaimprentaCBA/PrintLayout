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

const CONNECT_TIMEOUT_MS = 5000;   // timeout de connect al plotter (+1 retry)
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

// Abre una conexión fresca al plotter con timeout de connect + 1 reintento.
function openPlotter(cfg, attempt = 1) {
  return new Promise((resolve, reject) => {
    const p = net.connect({ host: cfg.plotterIP, port: cfg.plotterPort });
    let settled = false;
    const to = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { p.destroy(); } catch (_) { /* ignore */ }
      if (attempt < 2) openPlotter(cfg, attempt + 1).then(resolve, reject);
      else reject(new Error('timeout conectando al plotter'));
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
      if (attempt < 2) openPlotter(cfg, attempt + 1).then(resolve, reject);
      else reject(e);
    });
  });
}

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
  let started = false;     // ya tomó el candado y quedó activo (piping)
  let idleTimer = null;
  let absoluteTimer = null;

  waitingCount += 1;
  reportStatus();

  const bumpIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => finish('idle-timeout'), IDLE_TIMEOUT_MS);
  };

  // ÚNICO camino de salida: cubre cierre normal, error de cualquier lado,
  // idle-timeout y tope absoluto. Nunca deja el candado tomado.
  const finish = (reason) => {
    if (released) return;
    released = true;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (absoluteTimer) { clearTimeout(absoluteTimer); absoluteTimer = null; }
    try { if (plotter) plotter.end(); } catch (_) { /* ignore */ }
    try { socket.end(); } catch (_) { /* ignore */ }
    activeClients.delete(socket);
    if (started) activeClientIp = null;
    else waitingCount = Math.max(0, waitingCount - 1);
    reportStatus();
    if (token) { try { qrServer.releasePlotter(token); } catch (_) { /* ignore */ } token = null; }
    qrServer.emitLog(`Relay: fin de ${ip} (${reason}).`);
  };

  socket.on('error', () => finish('error del cliente'));
  socket.on('close', () => finish('cliente cerró'));

  // Idle-timer ya desde el accept: si el cliente abre y NUNCA manda nada (o queda
  // colgado), se cierra igual. Durante el pipe se resetea por cada byte/drain.
  bumpIdle();

  // Pausa perezosa: recién con el primer byte tomamos el candado y conectamos.
  socket.once('data', async (first) => {
    socket.pause(); // dejar de fluir hasta tener el plotter listo (no perder bytes)
    try {
      token = await qrServer.acquirePlotter(`relay:${ip}`);
    } catch (e) {
      qrServer.emitLog(`Relay: no se pudo tomar el plotter para ${ip} (${e.message}).`, 'error');
      finish('sin candado');
      return;
    }
    if (released) { // el cliente ya cerró mientras esperaba el candado
      finish('cliente cerró esperando');
      return;
    }
    // Pasó de "esperando" a "activo".
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
    if (released) { try { plotter.end(); } catch (_) { /* ignore */ } finish('cerrado antes de piping'); return; }

    qrServer.emitLog(`Relay: sirviendo corte de ${ip} → plotter ${cfg2.plotterIP}:${cfg2.plotterPort}.`);
    absoluteTimer = setTimeout(() => finish('tope absoluto'), ABSOLUTE_MAX_MS);
    plotter.on('error', (e) => { qrServer.emitLog(`Relay: error del plotter (${e.message}).`, 'error'); finish('error del plotter'); });
    plotter.on('close', () => finish('plotter cerró'));

    // Pipe transparente byte a byte, con reset del idle en ambos sentidos.
    socket.on('data', (d) => { bumpIdle(); try { plotter.write(d); } catch (_) { /* ignore */ } });
    plotter.on('data', (d) => { bumpIdle(); try { socket.write(d); } catch (_) { /* ignore */ } });
    socket.on('drain', bumpIdle);
    plotter.on('drain', bumpIdle);

    bumpIdle();
    try { plotter.write(first); } catch (_) { /* ignore */ } // el primer byte que ya leímos
    socket.resume(); // reanudar: los bytes buffered mientras conectábamos salen ahora, en orden
  });
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
