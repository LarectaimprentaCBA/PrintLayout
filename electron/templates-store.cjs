const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const STORE_FILENAME = 'templates.json';

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
    console.error('[templates-store] failed to read', err);
    return [];
  }
}

function writeAll(templates) {
  const file = getStorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(templates, null, 2), 'utf-8');
}

function generateId() {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function list() {
  return readAll();
}

function save(template) {
  const all = readAll();
  const now = new Date().toISOString();

  if (template.id) {
    const idx = all.findIndex((t) => t.id === template.id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...template, updatedAt: now };
      writeAll(all);
      return all[idx];
    }
    // Si vino con id pero no existe local, lo respetamos (caso de plantillas
    // pulleadas del repo de sync, cuyo id viene del manifest y debe persistir
    // para que futuros syncs encuentren la plantilla por id).
    const createdWithId = {
      ...template,
      createdAt: template.createdAt || now,
      updatedAt: now,
    };
    all.push(createdWithId);
    writeAll(all);
    return createdWithId;
  }

  const created = {
    ...template,
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
  const next = all.filter((t) => t.id !== id);
  writeAll(next);
  return { ok: true };
}

module.exports = { list, save, remove };
