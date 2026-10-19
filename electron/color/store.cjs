// Almacén por-PC de calibraciones de color: userData/color-calibrations.json
// Contiene las calibraciones (id, impresoras, papel, resultados, LUT, activa) que
// se comparten como las plantillas, MÁS las asignaciones manuales de COLAS de
// impresión, que NO se suben (son de esta PC).
//
// Por qué por cola y no por IP: las Epson entran por "EpsonNet Print Port", que
// encuentra la máquina por su MAC. Siguen imprimiendo aunque les cambie la IP, y
// el puerto de Windows se queda con la IP vieja. Si la corrección se guiara solo
// por IP, dejaría de aplicarse en silencio — o peor, se le aplicaría a otra
// máquina que tomó esa IP. Por eso la asignación manual es "esta COLA es esta
// impresora de la calibración", y el nombre de cola no cambia.
'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE = 'color-calibrations.json';
const DEFAULT = { version: 1, calibrations: [], manualIp: {}, manualPrinter: {}, backups: [] };
const MAX_BACKUPS = 20;

function storePath() { return path.join(app.getPath('userData'), FILE); }

function readAll() {
  try {
    const p = storePath();
    if (!fs.existsSync(p)) return { ...DEFAULT, manualIp: {}, manualPrinter: {}, calibrations: [], backups: [] };
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const out = {
      version: 1,
      calibrations: Array.isArray(data.calibrations) ? data.calibrations : [],
      manualIp: data.manualIp && typeof data.manualIp === 'object' ? data.manualIp : {},
      manualPrinter: {},
      backups: Array.isArray(data.backups) ? data.backups : [],
    };
    out.manualPrinter = normalizarManual(data);
    return out;
  } catch (e) {
    return { ...DEFAULT, manualIp: {}, manualPrinter: {}, calibrations: [], backups: [] };
  }
}

// Lleva las asignaciones manuales a una sola forma: cola → {ip, queue, port, assignedAt}.
// Migra el mapa viejo `manualIp` (cola → IP) sin perder nada: lo que ya estaba
// asignado sigue asignado, ahora con la cola como identidad.
function normalizarManual(data) {
  const out = {};
  const mp = data && data.manualPrinter && typeof data.manualPrinter === 'object' ? data.manualPrinter : {};
  for (const [queue, rec] of Object.entries(mp)) {
    if (!rec) continue;
    if (typeof rec === 'string') out[queue] = { ip: rec, queue: '', port: '', assignedAt: null };
    else out[queue] = {
      ip: rec.ip || '', queue: rec.queue || '', port: rec.port || '',
      assignedAt: rec.assignedAt || null,
    };
  }
  const mi = data && data.manualIp && typeof data.manualIp === 'object' ? data.manualIp : {};
  for (const [queue, ip] of Object.entries(mi)) {
    if (!ip || out[queue]) continue;
    out[queue] = { ip: String(ip), queue: '', port: '', assignedAt: null };
  }
  return out;
}

function writeAll(data) {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

function list() { return readAll().calibrations; }
function get(id) { return readAll().calibrations.find((c) => c.id === id) || null; }

// Guarda (upsert por id). No toca sharedAt/sharedHash salvo que vengan en el objeto.
function save(cal) {
  const data = readAll();
  const now = new Date().toISOString();
  const i = data.calibrations.findIndex((c) => c.id === cal.id);
  const merged = { ...cal, updatedAt: cal.updatedAt || now, createdAt: cal.createdAt || (i >= 0 ? data.calibrations[i].createdAt : now) };
  if (i >= 0) data.calibrations[i] = merged; else data.calibrations.push(merged);
  writeAll(data);
  return merged;
}

function remove(id) {
  const data = readAll();
  data.calibrations = data.calibrations.filter((c) => c.id !== id);
  writeAll(data);
  return { ok: true };
}

// Activa/desactiva. Al activar, desactiva las demás de la MISMA impresora (misma IP a corregir).
function setActive(id, active) {
  const data = readAll();
  const cal = data.calibrations.find((c) => c.id === id);
  if (!cal) return { ok: false, error: 'no existe' };
  cal.active = !!active;
  cal.updatedAt = new Date().toISOString();
  if (active) {
    const ip = cal.correctPrinter && cal.correctPrinter.ip;
    for (const o of data.calibrations) {
      if (o.id !== id && o.correctPrinter && o.correctPrinter.ip && ip && o.correctPrinter.ip === ip) o.active = false;
    }
  }
  writeAll(data);
  return { ok: true, calibration: cal };
}

// ¿Hay alguna calibración activa en esta PC? (barato: evita resolver IP si no hace falta)
function hasAnyActive() {
  return readAll().calibrations.some((c) => c.active);
}

// Devuelve la calibración ACTIVA cuya impresora a corregir tiene esa IP (o null).
// `deviceName` = la cola por la que se está imprimiendo, para el chequeo de abajo.
function getActiveForIp(ip, deviceName) {
  if (!ip) return null;
  const data = readAll();
  const cal = data.calibrations.find((c) => c.active && c.correctPrinter && c.correctPrinter.ip === ip);
  if (!cal) return null;
  // Si esa misma IP ya está asignada a mano a OTRA cola, no corregimos acá: las
  // IPs se reciclan, y corregir la máquina equivocada es peor que no corregir.
  for (const [q, rec] of Object.entries(data.manualPrinter)) {
    if (q === deviceName) continue;
    if (rec.ip && rec.ip === ip) return null;
  }
  return cal;
}

// Devuelve la calibración ACTIVA asignada A MANO a esa cola (o null si la cola
// no tiene asignación). Busca por la IP que se guardó al asignar y, si la IP ya
// no coincide con ninguna calibración, por el nombre de cola y el del puerto,
// que no cambian aunque la impresora tome otra IP.
function getActiveForQueue(deviceName) {
  if (!deviceName) return null;
  const data = readAll();
  const rec = data.manualPrinter[deviceName];
  if (!rec) return null;
  const activas = data.calibrations.filter((c) => c.active && c.correctPrinter);
  if (rec.ip) {
    const porIp = activas.find((c) => c.correctPrinter.ip === rec.ip);
    if (porIp) return porIp;
  }
  const q = rec.queue || deviceName;
  const porCola = activas.find((c) => c.correctPrinter.queue && c.correctPrinter.queue === q);
  if (porCola) return porCola;
  if (rec.port) {
    const porPuerto = activas.find((c) => c.correctPrinter.port && c.correctPrinter.port === rec.port);
    if (porPuerto) return porPuerto;
  }
  return null;
}

// ¿Esta cola tiene asignación manual? (sin resolver la calibración)
function hasManualFor(deviceName) {
  if (!deviceName) return false;
  return !!readAll().manualPrinter[deviceName];
}

// Asignaciones manuales completas: cola → {ip, queue, port, assignedAt}.
function getManualPrinter() { return readAll().manualPrinter; }

// Mapa manual cola→IP, derivado de las asignaciones. Lo usan los resolutores de
// IP de printers.cjs; la fuente de verdad es manualPrinter.
function getManualIp() {
  const out = {};
  for (const [q, rec] of Object.entries(readAll().manualPrinter)) if (rec.ip) out[q] = rec.ip;
  return out;
}

// Asigna (o quita, con rec = null) una cola a una impresora de calibración.
function setManualPrinter(queue, rec) {
  if (!queue) return { ok: false, error: 'falta la cola' };
  const data = readAll();
  if (!rec || (!rec.ip && !rec.queue && !rec.port)) {
    delete data.manualPrinter[queue];
    delete data.manualIp[queue];
  } else {
    data.manualPrinter[queue] = {
      ip: String(rec.ip || '').trim(),
      queue: String(rec.queue || '').trim(),
      port: String(rec.port || '').trim(),
      assignedAt: rec.assignedAt || new Date().toISOString(),
    };
    // El mapa viejo queda espejado para que nada que lo lea se rompa.
    if (data.manualPrinter[queue].ip) data.manualIp[queue] = data.manualPrinter[queue].ip;
    else delete data.manualIp[queue];
  }
  writeAll(data);
  return { ok: true, manualPrinter: data.manualPrinter };
}

// Compatibilidad: asignar solo la IP sigue funcionando.
function setManualIp(queue, ip) {
  return setManualPrinter(queue, ip ? { ip } : null);
}

// Guarda una copia de una calibración anterior (antes de pisarla en un pull), para poder volver.
function addBackup(cal) {
  if (!cal) return;
  const data = readAll();
  data.backups.unshift({ ...cal, backedUpAt: new Date().toISOString() });
  if (data.backups.length > MAX_BACKUPS) data.backups.length = MAX_BACKUPS;
  writeAll(data);
}
function listBackups() { return readAll().backups; }

function markShared(id, sharedAt, sharedHash) {
  const data = readAll();
  const cal = data.calibrations.find((c) => c.id === id);
  if (cal) { cal.sharedAt = sharedAt; cal.sharedHash = sharedHash; writeAll(data); }
  return { ok: true };
}

module.exports = {
  storePath, readAll, writeAll, list, get, save, remove,
  setActive, getActiveForIp, getActiveForQueue, hasAnyActive, hasManualFor,
  getManualIp, setManualIp, getManualPrinter, setManualPrinter, markShared,
  addBackup, listBackups,
};
