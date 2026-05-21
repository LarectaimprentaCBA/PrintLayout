const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Persistencia de la lista de tabs abiertas. UN solo archivo
// userData/open-tabs.json con la lista completa + activeTabId. El state del
// editor (images / assignments / minPages) NO vive aca — ya esta cubierto por
// work-states-store.cjs, indexado por el template id sintetico (tabtpl_<tab>).
//
// Al reabrir la app, restoramos la lista de tabs, y useLayoutEditor se ocupa
// de hidratar el state del editor cuando el usuario switchea a cada tab.
//
// Formato:
//   {
//     version: 1,
//     activeTabId: 'tab_xxx',
//     tabs: [
//       { id, name, jobId, isDirty, viewingFace, currentPage, customPaper,
//         template: {...} }
//     ],
//     savedAt: ISO
//   }

const FILENAME = 'open-tabs.json';

function getFilePath() {
  return path.join(app.getPath('userData'), FILENAME);
}

function load() {
  const file = getFilePath();
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (err) {
    console.error('[open-tabs] failed to read:', err);
    return null;
  }
}

function save(payload) {
  const file = getFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const body = {
    version: 1,
    ...payload,
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(tmp, JSON.stringify(body), 'utf-8');
  fs.renameSync(tmp, file);
  return { ok: true };
}

function clear() {
  const file = getFilePath();
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return { ok: true };
}

module.exports = { load, save, clear };
