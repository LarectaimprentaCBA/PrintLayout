// Config de "Rótulos escolares". Vive en userData/rotulos-config.json (no en el
// repo/bundle). Hoy sólo guarda la carpeta del catálogo COMPARTIDO:
//
//   { rotulosSharedDir }   // '' = usar la carpeta local (userData/rotulos)
//
// Si rotulosSharedDir apunta a una carpeta de red (UNC \\MARIANO\RotulosModelos)
// varias PC comparten los mismos modelos/tipografías (lectura y escritura).
// Vacío = todo local, igual que antes (back-compat). Mismo patrón atómico
// (.tmp+rename) que qrcut/config-store.cjs.

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FILENAME = 'rotulos-config.json';
const DEFAULTS = { rotulosSharedDir: '' };

function getFilePath() {
  return path.join(app.getPath('userData'), FILENAME);
}

function sanitize(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  return {
    rotulosSharedDir: typeof c.rotulosSharedDir === 'string' ? c.rotulosSharedDir.trim() : '',
  };
}

function load() {
  const file = getFilePath();
  if (!fs.existsSync(file)) return { ...DEFAULTS };
  try {
    return sanitize(JSON.parse(fs.readFileSync(file, 'utf-8')));
  } catch (err) {
    console.error('[rotulos] no se pudo leer la config:', err);
    return { ...DEFAULTS };
  }
}

// Guarda un patch (merge sobre lo actual). Devuelve la config saneada final.
function save(patch) {
  const merged = sanitize({ ...load(), ...(patch || {}) });
  const file = getFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
  return merged;
}

module.exports = { load, save, DEFAULTS };
