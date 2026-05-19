// Store local de presets de hoja custom del usuario. Los built-in (A4, A3,
// etc.) no viven aca, vienen de src/lib/grid.js. Persistimos solo los que
// agrega el usuario.

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const STORE_FILENAME = 'paper-presets.json';

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILENAME);
}

function readAll() {
  const file = getStorePath();
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[paper-presets-store] failed to read', err);
    return [];
  }
}

function writeAll(presets) {
  const file = getStorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(presets, null, 2), 'utf-8');
}

function generateId() {
  return `pp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function list() {
  return readAll();
}

function save(preset) {
  const all = readAll();
  const now = new Date().toISOString();

  if (preset.id) {
    const idx = all.findIndex((p) => p.id === preset.id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...preset, updatedAt: now };
      writeAll(all);
      return all[idx];
    }
    // Mismo tratamiento que templates-store: si vino con id pero no esta local,
    // lo respetamos. Pasa cuando pulleamos un preset remoto: queremos preservar
    // el id del manifest para que futuros syncs lo encuentren.
    const createdWithId = {
      ...preset,
      createdAt: preset.createdAt || now,
      updatedAt: now,
    };
    all.push(createdWithId);
    writeAll(all);
    return createdWithId;
  }

  const created = {
    ...preset,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  all.push(created);
  writeAll(all);
  return created;
}

function remove(id) {
  const all = readAll();
  const next = all.filter((p) => p.id !== id);
  writeAll(next);
  return { ok: true };
}

module.exports = { list, save, remove };
