const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Trabajos guardados. Un archivo JSON por job en userData/jobs/{id}.json.
// Cada job es auto-contenido: lleva la plantilla embebida, las imagenes y
// las asignaciones. Asi reabrir un job nunca depende de que la plantilla
// original siga existiendo en la lista local.
//
// El formato en disco:
//   { id, name, createdAt, updatedAt,
//     template: {...}, images: [...],
//     assignmentsFront, assignmentsBack, minPages,
//     savedAt }

const SUBDIR = 'jobs';

function getDir() {
  return path.join(app.getPath('userData'), SUBDIR);
}

function getFilePath(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getDir(), `${safe}.json`);
}

function generateId() {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Devuelve metadata liviana de todos los jobs (sin las imagenes ni la
// plantilla embebida). Sirve para mostrar la lista sin meter 200 MB en
// memoria si hay muchos jobs grandes.
function listLight() {
  const dir = getDir();
  if (!fs.existsSync(dir)) return [];
  const out = [];
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    console.error('[jobs] failed to list:', err);
    return [];
  }
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.tmp')) continue;
    const file = path.join(dir, name);
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      const j = JSON.parse(raw);
      if (!j || typeof j !== 'object') continue;
      out.push({
        id: j.id,
        name: j.name,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        imageCount: Array.isArray(j.images) ? j.images.length : 0,
        templateName: j.template?.name ?? null,
        pageWidthMm: j.template?.pageWidthMm ?? null,
        pageHeightMm: j.template?.pageHeightMm ?? null,
      });
    } catch (err) {
      console.warn('[jobs] could not read', name, err.message);
    }
  }
  out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return out;
}

function load(id) {
  const file = getFilePath(id);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (err) {
    console.error(`[jobs] failed to read ${id}:`, err);
    return null;
  }
}

// Atomic write: tmp + rename. Genera id si no viene, completa timestamps.
function save(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload invalido');
  }
  const now = new Date().toISOString();
  const id = payload.id || generateId();
  const existing = payload.id ? load(payload.id) : null;
  const merged = {
    ...payload,
    id,
    createdAt: existing?.createdAt || payload.createdAt || now,
    updatedAt: now,
    savedAt: now,
  };
  const file = getFilePath(id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(merged), 'utf-8');
  fs.renameSync(tmp, file);
  return merged;
}

function remove(id) {
  const file = getFilePath(id);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
  return { ok: true };
}

module.exports = { listLight, load, save, remove };
