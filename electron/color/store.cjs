// Almacén por-PC de calibraciones de color: userData/color-calibrations.json
// Contiene las calibraciones (id, impresoras por IP, papel, resultados, LUT, activa) que
// se comparten como las plantillas, MÁS un mapa manual cola→IP que NO se sube (per-PC).
'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE = 'color-calibrations.json';
const DEFAULT = { version: 1, calibrations: [], manualIp: {}, backups: [] };
const MAX_BACKUPS = 20;

function storePath() { return path.join(app.getPath('userData'), FILE); }

function readAll() {
  try {
    const p = storePath();
    if (!fs.existsSync(p)) return { ...DEFAULT };
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return {
      version: 1,
      calibrations: Array.isArray(data.calibrations) ? data.calibrations : [],
      manualIp: data.manualIp && typeof data.manualIp === 'object' ? data.manualIp : {},
      backups: Array.isArray(data.backups) ? data.backups : [],
    };
  } catch (e) {
    return { ...DEFAULT };
  }
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
function getActiveForIp(ip) {
  if (!ip) return null;
  return readAll().calibrations.find((c) => c.active && c.correctPrinter && c.correctPrinter.ip === ip) || null;
}

// Mapa manual cola→IP (per-PC, para colas WSD/IPP sin IP visible).
function getManualIp() { return readAll().manualIp; }
function setManualIp(queue, ip) {
  const data = readAll();
  if (!ip) delete data.manualIp[queue]; else data.manualIp[queue] = ip;
  writeAll(data);
  return { ok: true };
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
  setActive, getActiveForIp, hasAnyActive, getManualIp, setManualIp, markShared,
  addBackup, listBackups,
};
