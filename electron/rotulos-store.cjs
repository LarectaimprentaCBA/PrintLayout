const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const rotulosConfig = require('./rotulos-config-store.cjs');

// Almacen local de "Rotulos escolares": dos catalogos (tipografias y modelos)
// bajo userData/rotulos/. Solo maneja el JSON; el copiado/borrado de archivos
// (fuentes y artes) lo hacen los handlers del main usando estas rutas.
//
//   userData/rotulos/
//     fonts-index.json          -> [{ id, familia, archivo, ext, addedAt }]
//     fonts/<id>.<ext>          -> archivo de fuente
//     models-index.json         -> [{ id, nombre, thumb, sizes:{...}, ... }]
//     models/<id>/<size>.<ext>  -> imagenes de arte por tamanio

// Base del catálogo. Si hay carpeta compartida configurada (UNC de red), se usa
// esa; si está vacía, la local userData/rotulos (back-compat). Se recalcula por
// llamada → cambiar la carpeta surte efecto sin reiniciar (la próxima IPC ya usa
// la base nueva). Todas las rutas (fonts/models/índices) derivan de acá.
function rotulosDir() {
  const shared = rotulosConfig.load().rotulosSharedDir;
  return shared ? shared : path.join(app.getPath('userData'), 'rotulos');
}
function fontsDir() {
  return path.join(rotulosDir(), 'fonts');
}
function modelsDir() {
  return path.join(rotulosDir(), 'models');
}
function modelDir(id) {
  return path.join(modelsDir(), id);
}
function fontsIndexPath() {
  return path.join(rotulosDir(), 'fonts-index.json');
}
function modelsIndexPath() {
  return path.join(rotulosDir(), 'models-index.json');
}

function ensureDirs() {
  fs.mkdirSync(fontsDir(), { recursive: true });
  fs.mkdirSync(modelsDir(), { recursive: true });
}

function readArray(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[rotulos-store] failed to read', file, err);
    return [];
  }
}

function writeArray(file, arr) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(arr, null, 2), 'utf-8');
}

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// --- Tipografias ---

function listFonts() {
  return readArray(fontsIndexPath());
}

function addFont(entry) {
  const all = readArray(fontsIndexPath());
  const created = {
    ...entry,
    id: entry.id || generateId('font'),
    addedAt: entry.addedAt || new Date().toISOString(),
  };
  all.push(created);
  writeArray(fontsIndexPath(), all);
  return created;
}

function removeFont(id) {
  const all = readArray(fontsIndexPath());
  writeArray(fontsIndexPath(), all.filter((f) => f.id !== id));
  return { ok: true };
}

// --- Modelos ---

function listModels() {
  return readArray(modelsIndexPath());
}

function saveModel(model) {
  const all = readArray(modelsIndexPath());
  const now = new Date().toISOString();
  if (model.id) {
    const idx = all.findIndex((m) => m.id === model.id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...model, updatedAt: now };
      writeArray(modelsIndexPath(), all);
      return all[idx];
    }
  }
  const created = {
    ...model,
    id: model.id || generateId('rot'),
    createdAt: now,
    updatedAt: now,
  };
  all.push(created);
  writeArray(modelsIndexPath(), all);
  return created;
}

function removeModel(id) {
  const all = readArray(modelsIndexPath());
  writeArray(modelsIndexPath(), all.filter((m) => m.id !== id));
  return { ok: true };
}

module.exports = {
  ensureDirs,
  rotulosDir,
  fontsDir,
  modelsDir,
  modelDir,
  generateId,
  listFonts,
  addFont,
  removeFont,
  listModels,
  saveModel,
  removeModel,
};
