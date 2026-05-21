const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Persistencia del "trabajo en curso" por plantilla. Un archivo JSON por
// templateId, asi guardar uno no toca a los otros. NO se guarda el historial
// de undo/redo (es transient — se pierde al cerrar la app), solo el estado
// final: imagenes cargadas + asignaciones de celdas + minPages.

const SUBDIR = 'work-states';

function getDir() {
  return path.join(app.getPath('userData'), SUBDIR);
}

function getFilePath(templateId) {
  // Sanitize: solo permitir caracteres safe (los ids son tpl_xxx, dyn_xxx).
  const safe = String(templateId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getDir(), `${safe}.json`);
}

function load(templateId) {
  const file = getFilePath(templateId);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (err) {
    console.error(`[work-states] failed to read ${templateId}:`, err);
    return null;
  }
}

// Escritura atomica: tmp + rename. Asi un crash mid-write no corrompe el JSON
// (worst case: te quedaste con el ultimo save bueno).
function save(templateId, state) {
  const file = getFilePath(templateId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const payload = {
    ...state,
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8');
  fs.renameSync(tmp, file);
  return { ok: true };
}

function remove(templateId) {
  const file = getFilePath(templateId);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
  return { ok: true };
}

function list() {
  const dir = getDir();
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.json') && !name.endsWith('.tmp'))
      .map((name) => name.slice(0, -5)); // quitar .json
  } catch (err) {
    console.error('[work-states] failed to list:', err);
    return [];
  }
}

module.exports = { load, save, remove, list };
