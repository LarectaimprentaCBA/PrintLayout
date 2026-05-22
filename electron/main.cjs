const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { autoUpdater } = require('electron-updater');
const templatesStore = require('./templates-store.cjs');
const templatesSync = require('./templates-sync.cjs');
const paperPresetsStore = require('./paper-presets-store.cjs');
const paperPresetsSync = require('./paper-presets-sync.cjs');
const workStatesStore = require('./work-states-store.cjs');
const jobsStore = require('./jobs-store.cjs');
const openTabsStore = require('./open-tabs-store.cjs');

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

const isDev = process.env.NODE_ENV === 'development';

// Localizacion de scripts y runtime de Python.
//
// - dev: viven en ../python y ../python-runtime relativo a electron/main.cjs.
// - electron-packager (build "pack"): mismos paths, todo plano en resources/app/.
// - electron-builder + asar (instalador NSIS): van como extraResources y
//   quedan en process.resourcesPath/python y .../python-runtime.
//
// Probamos primero el path adyacente; si no existe, caemos a resourcesPath.
function resolveResourcePath(rel) {
  const candidates = [
    path.join(__dirname, '..', rel),
    path.join(process.resourcesPath || '', rel),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates[0];
}

const PYTHON_DIR = resolveResourcePath('python');

function resolvePythonBin() {
  if (process.env.PRINTLAYOUT_PYTHON) return process.env.PRINTLAYOUT_PYTHON;
  const embedded = path.join(
    resolveResourcePath('python-runtime'),
    'python.exe',
  );
  if (fs.existsSync(embedded)) return embedded;
  return 'python';
}
const PYTHON_BIN = resolvePythonBin();

let isQuittingConfirmed = false;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0b0d10',
    title: 'PrintLayout',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Intercept close para pedirle al renderer si hay tabs sin guardar. Si las
  // hay, muestra confirm; sino cierra directo. Se evita si ya hicimos quit
  // antes (asi no se bucla).
  win.on('close', async (e) => {
    if (isQuittingConfirmed) return;
    e.preventDefault();
    let shouldClose = true;
    try {
      shouldClose = await win.webContents.executeJavaScript(
        'window.__printlayoutCanClose ? window.__printlayoutCanClose() : Promise.resolve(true)',
        true,
      );
    } catch (err) {
      console.warn('[close] askCanClose fallo:', err);
    }
    if (shouldClose) {
      isQuittingConfirmed = true;
      win.close();
    }
  });

  if (isDev) {
    win.loadURL('http://localhost:5174');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function runPython(scriptName, { args = [], stdin = null } = {}) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PYTHON_DIR, scriptName);
    if (!fs.existsSync(scriptPath)) {
      reject(new Error(`No se encontró el script: ${scriptPath}`));
      return;
    }
    const proc = spawn(PYTHON_BIN, [scriptPath, ...args], {
      cwd: PYTHON_DIR,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python salió con código ${code}: ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });

    if (stdin !== null) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }
  });
}

ipcMain.handle('templates:list', () => templatesStore.list());
ipcMain.handle('templates:save', (_evt, template) => templatesStore.save(template));
ipcMain.handle('templates:delete', (_evt, id) => templatesStore.remove(id));

// Trabajo en curso por plantilla (auto-save). Cada plantilla tiene su propio
// archivo JSON, asi guardar uno no toca a los demas.
ipcMain.handle('work-states:list', () => workStatesStore.list());
ipcMain.handle('work-states:load', (_evt, templateId) => workStatesStore.load(templateId));
ipcMain.handle('work-states:save', (_evt, { templateId, state }) =>
  workStatesStore.save(templateId, state),
);
ipcMain.handle('work-states:delete', (_evt, templateId) => workStatesStore.remove(templateId));

// Trabajos guardados (jobs). Cada job es un archivo JSON auto-contenido con
// plantilla + imagenes + asignaciones, en userData/jobs/.
ipcMain.handle('jobs:list', () => jobsStore.listLight());
ipcMain.handle('jobs:load', (_evt, id) => jobsStore.load(id));
ipcMain.handle('jobs:save', (_evt, payload) => {
  try {
    return { ok: true, job: jobsStore.save(payload) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('jobs:delete', (_evt, id) => jobsStore.remove(id));

// Guardar trabajo a un archivo .pljob elegido por el usuario via showSaveDialog.
// El payload va tal cual + savedAt. El archivo es un JSON con todo embebido,
// auto-contenido (igual que el formato de jobs internos).
ipcMain.handle('jobs:save-as', async (_evt, { payload, defaultName }) => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const safe = String(defaultName || 'trabajo').replace(/[<>:"/\\|?*]/g, '_');
    const result = await dialog.showSaveDialog(win, {
      title: 'Guardar trabajo como…',
      defaultPath: `${safe}.pljob`,
      filters: [
        { name: 'PrintLayout Job', extensions: ['pljob', 'json'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    const body = { ...payload, savedAt: new Date().toISOString() };
    fs.writeFileSync(result.filePath, JSON.stringify(body), 'utf-8');
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Abrir un .pljob desde el filesystem: file picker + lectura del JSON.
// El archivo es el mismo formato que jobs:save-as (payload + savedAt).
ipcMain.handle('jobs:open-from-file', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Abrir trabajo…',
      properties: ['openFile'],
      filters: [
        { name: 'PrintLayout Job', extensions: ['pljob', 'json'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return { canceled: true };
    }
    const filePath = result.filePaths[0];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const job = JSON.parse(raw);
    return { ok: true, path: filePath, job };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Lee un .pljob desde un path conocido (sin pasar por el dialog). Util para
// "abrir reciente" o cuando el path ya esta resuelto.
ipcMain.handle('jobs:load-from-path', async (_evt, { path: filePath }) => {
  try {
    if (!filePath) return { ok: false, error: 'path vacio' };
    const raw = fs.readFileSync(filePath, 'utf-8');
    const job = JSON.parse(raw);
    return { ok: true, path: filePath, job };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Sobreescribe un job en un path conocido (Ctrl+S despues de un Save As).
ipcMain.handle('jobs:save-to-path', async (_evt, { path: filePath, payload }) => {
  try {
    if (!filePath) return { ok: false, error: 'path vacio' };
    const body = { ...payload, savedAt: new Date().toISOString() };
    fs.writeFileSync(filePath, JSON.stringify(body), 'utf-8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Tabs abiertas: persistimos la lista para restaurarlas al reabrir la app.
// El state del editor (images/assignments) se persiste aparte via work-states,
// indexado por el template id sintetico de cada tab.
ipcMain.handle('open-tabs:load', () => openTabsStore.load());
ipcMain.handle('open-tabs:save', (_evt, payload) => {
  try {
    return openTabsStore.save(payload);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Sync de plantillas con GitHub.
// templates:sync-pull => pulla manifest + plantillas nuevas/cambiadas. Sobrescribe
//   las locales que esten marcadas como compartidas. Devuelve resumen.
// templates:share => sube una plantilla local al repo y la marca como sharedAt.
// templates:can-share => true si el build tiene token configurado.
ipcMain.handle('templates:can-share', () => templatesSync.hasToken());

ipcMain.handle('templates:sync-pull', async () => {
  try {
    const remote = await templatesSync.listRemote();
    const local = templatesStore.list();
    const localById = new Map(local.map((t) => [t.id, t]));

    const added = [];
    const updated = [];
    const replaced = [];
    const errors = [];

    for (const entry of remote) {
      const localTpl = localById.get(entry.id);
      // Si ya existe local con mismo hash, no hacer nada.
      if (localTpl && localTpl.sharedHash === entry.hash) continue;

      try {
        const full = await templatesSync.pullTemplate(entry.id);
        if (!full) {
          errors.push({ id: entry.id, name: entry.name, error: 'no encontrada en repo' });
          continue;
        }

        // Primer sync de una plantilla que ya existia local con el mismo
        // nombre (pero distinto id porque cada PC genera el suyo al cargar
        // un PDF). Borramos la local-only para no duplicar.
        let displaceId = null;
        if (!localTpl) {
          const localByName = local.find(
            (t) => t.name === entry.name && !t.sharedAt && t.id !== entry.id,
          );
          if (localByName) {
            displaceId = localByName.id;
            templatesStore.remove(localByName.id);
          }
        }

        const merged = {
          ...full,
          id: entry.id,
          sharedAt: entry.updatedAt,
          sharedHash: entry.hash,
        };
        const saved = templatesStore.save(merged);
        if (localTpl) updated.push({ id: saved.id, name: saved.name });
        else if (displaceId) replaced.push({ id: saved.id, name: saved.name });
        else added.push({ id: saved.id, name: saved.name });
      } catch (err) {
        errors.push({ id: entry.id, name: entry.name, error: err.message });
      }
    }

    // Cleanup pass: para cada nombre que existe en el repo, hay UNA plantilla
    // local canonica (la que tiene el id del manifest). Cualquier otra local
    // con el mismo nombre y un id distinto es un duplicado: o es local-only
    // (caso original de dos PCs subiendo la misma) o es una copia bogus
    // generada por el bug de templates-store que descartaba ids pulleados.
    const remoteByName = new Map(remote.map((e) => [e.name, e.id]));
    const all = templatesStore.list();
    const cleaned = [];
    for (const t of all) {
      const canonicalId = remoteByName.get(t.name);
      if (canonicalId && t.id !== canonicalId) {
        templatesStore.remove(t.id);
        cleaned.push({ id: t.id, name: t.name });
      }
    }

    return { ok: true, added, updated, replaced, cleaned, errors };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('templates:share', async (_evt, template) => {
  try {
    if (!templatesSync.hasToken()) {
      return { ok: false, error: 'Token no configurado en este build.' };
    }
    const r = await templatesSync.pushTemplate(template);
    if (!r.ok) return r;
    // Marcar la plantilla local como compartida.
    const updated = templatesStore.save({
      ...template,
      sharedAt: r.updatedAt,
      sharedHash: r.hash,
    });
    return { ok: true, template: updated };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Paper presets: store local CRUD.
ipcMain.handle('paper-presets:list', () => paperPresetsStore.list());
ipcMain.handle('paper-presets:save', (_evt, preset) => paperPresetsStore.save(preset));
ipcMain.handle('paper-presets:delete', (_evt, id) => paperPresetsStore.remove(id));

// Sync con GitHub (mismo repo que plantillas, archivo paper-presets.json).
ipcMain.handle('paper-presets:can-sync', () => paperPresetsSync.hasToken());

ipcMain.handle('paper-presets:sync-pull', async () => {
  try {
    const remote = await paperPresetsSync.listRemote();
    const local = paperPresetsStore.list();
    const localById = new Map(local.map((p) => [p.id, p]));

    const added = [];
    const updated = [];
    const errors = [];

    for (const entry of remote) {
      const localP = localById.get(entry.id);
      // Si ya existe local con mismo hash, no hacer nada.
      if (localP && localP.sharedHash === entry.hash) continue;
      try {
        const merged = {
          id: entry.id,
          label: entry.label,
          w: Number(entry.w),
          h: Number(entry.h),
          sharedAt: entry.updatedAt,
          sharedHash: entry.hash,
        };
        const saved = paperPresetsStore.save(merged);
        if (localP) updated.push({ id: saved.id, label: saved.label });
        else added.push({ id: saved.id, label: saved.label });
      } catch (err) {
        errors.push({ id: entry.id, label: entry.label, error: err.message });
      }
    }

    // No borramos locales que no esten en remote: el usuario puede tener presets
    // privados que nunca subio. La conciliacion final es responsabilidad del push.

    return { ok: true, added, updated, errors };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('paper-presets:sync-push', async () => {
  try {
    if (!paperPresetsSync.hasToken()) {
      return { ok: false, error: 'Token no configurado en este build.' };
    }
    const local = paperPresetsStore.list();
    const r = await paperPresetsSync.pushAll(local);
    if (!r.ok) return r;
    // Marcar cada local con sharedAt + sharedHash segun lo que subio el sync.
    const byId = new Map(r.entries.map((e) => [e.id, e]));
    for (const p of local) {
      const e = byId.get(p.id);
      if (!e) continue;
      paperPresetsStore.save({
        ...p,
        sharedAt: e.updatedAt,
        sharedHash: e.hash,
      });
    }
    return { ok: true, count: r.count };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('templates:parse-pdf', async (_evt, payload) => {
  // payload = { bytes, doubleSided }
  const bytes = payload?.bytes ?? payload; // backward compat
  const doubleSided = !!payload?.doubleSided;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printlayout-pdf-'));
  const tmpPdf = path.join(tmpDir, 'template.pdf');
  try {
    fs.writeFileSync(tmpPdf, Buffer.from(bytes));
    const args = [tmpPdf];
    if (doubleSided) args.push('--double-sided');
    const { stdout } = await runPython('parse_template.py', { args });
    let parsed;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch (e) {
      return { ok: false, error: `Salida inválida del parser: ${e.message}` };
    }
    return parsed;
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

// Extrae imagenes raster embebidas de un PDF. Las deja en un dir temporal
// y devuelve metadata + thumbs. El renderer despues pide los bytes con
// pdf:read-extracted-image y limpia con pdf:cleanup-extracted.
ipcMain.handle('pdf:extract-images', async (_evt, payload) => {
  const bytes = payload?.bytes ?? payload;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printlayout-extract-'));
  const tmpPdf = path.join(tmpDir, 'source.pdf');
  const outDir = path.join(tmpDir, 'images');
  try {
    fs.writeFileSync(tmpPdf, Buffer.from(bytes));
    fs.mkdirSync(outDir);
    const { stdout } = await runPython('extract_pdf_images.py', { args: [tmpPdf, outDir] });
    let parsed;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch (e) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      return { ok: false, error: `Salida invalida del extractor: ${e.message}` };
    }
    if (!parsed.ok) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      return parsed;
    }
    parsed.tmpDir = tmpDir;
    return parsed;
  } catch (err) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('pdf:read-extracted-image', async (_evt, payload) => {
  try {
    const filePath = payload?.path;
    if (!filePath) return { ok: false, error: 'path requerido' };
    const normalized = path.normalize(filePath);
    const tmpRoot = path.normalize(os.tmpdir());
    if (!normalized.startsWith(tmpRoot)) {
      return { ok: false, error: 'path fuera de tmpdir' };
    }
    const buf = fs.readFileSync(normalized);
    return { ok: true, bytes: buf };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('pdf:cleanup-extracted', async (_evt, payload) => {
  try {
    const dir = payload?.tmpDir;
    if (!dir) return { ok: false };
    const normalized = path.normalize(dir);
    const tmpRoot = path.normalize(os.tmpdir());
    if (!normalized.startsWith(tmpRoot)) return { ok: false };
    fs.rmSync(normalized, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('plotter:send-cut', async (_evt, payload) => {
  try {
    const stdin = JSON.stringify(payload);
    const { stdout } = await runPython('send_to_plotter.py', { stdin });
    let result;
    try {
      result = JSON.parse(stdout.trim());
    } catch (e) {
      return { ok: false, error: `Salida inválida del sender: ${e.message}` };
    }
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('export:save-pdf', async (evt, { defaultName, bytes }) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  const result = await dialog.showSaveDialog(win, {
    title: 'Guardar PDF',
    defaultPath: defaultName ?? 'PrintLayout.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }
  try {
    fs.writeFileSync(result.filePath, Buffer.from(bytes));
    return { canceled: false, path: result.filePath };
  } catch (err) {
    return { canceled: false, error: err.message };
  }
});

ipcMain.handle('shell:show-item', (_evt, p) => {
  shell.showItemInFolder(p);
});

// PrintHelper.exe: nativo .NET que muestra PrintDialog estandar (document
// mode) — los settings que el usuario toque en Preferencias del driver se
// aplican solo a ese trabajo, NUNCA persisten como defaults del sistema.
// Esto es lo que hacen Adobe Reader, Word, Notepad. webContents.print() de
// Electron no permite eso porque su path de DocumentProperties usa default
// mode y persiste — bug viejo de Chromium.
//
// El binario se compila desde helper/PrintHelper.cs con helper/build-helper.ps1
// y se commitea firmado al repo. En dev vive en helper/PrintHelper.exe; en
// packaged va como extraResource a resources/PrintHelper.exe.
function resolvePrintHelper() {
  const candidates = [
    path.join(__dirname, '..', 'helper', 'PrintHelper.exe'),
    path.join(process.resourcesPath || '', 'PrintHelper.exe'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

// Decodifica una dataURL `data:image/png;base64,xxx...` a Buffer.
function dataUrlToBuffer(dataUrl) {
  const m = /^data:[^;]+;base64,(.+)$/.exec(dataUrl ?? '');
  if (!m) throw new Error('dataURL invalida (se esperaba base64).');
  return Buffer.from(m[1], 'base64');
}

// Lista las impresoras instaladas via PowerShell (Get-Printer). El usuario
// elige cual usar desde nuestro PrintModal y nunca abrimos el dialogo nativo
// de Windows — eso evita que cualquier toqueteo a Preferencias del driver
// quede como default del sistema.
ipcMain.handle('print:list-printers', async () => {
  return new Promise((resolve) => {
    const proc = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance -ClassName Win32_Printer | Select-Object Name, Default | ConvertTo-Json -Compress",
      ],
      { windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    proc.on('error', (err) => resolve({ ok: false, error: err.message, printers: [] }));
    proc.on('close', () => {
      try {
        const raw = stdout.trim();
        if (!raw) {
          resolve({ ok: true, printers: [] });
          return;
        }
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const printers = list
          .filter((p) => p && p.Name)
          .map((p) => ({
            name: p.Name,
            displayName: p.Name,
            isDefault: !!p.Default,
          }));
        resolve({ ok: true, printers });
      } catch (err) {
        resolve({
          ok: false,
          error: `No se pudo parsear lista de impresoras: ${err.message}. ${stderr}`,
          printers: [],
        });
      }
    });
  });
});

// Path del DEVMODE guardado por PrintLayout para una impresora dada. Lo
// guardamos en userData/printer-devmodes/<hash>.bin (hash del nombre porque
// los nombres pueden tener \, /, :, etc. invalidos en filename).
function devmodeFilePath(deviceName) {
  if (!deviceName) return null;
  const crypto = require('node:crypto');
  const hash = crypto.createHash('sha1').update(deviceName, 'utf-8').digest('hex').slice(0, 16);
  const dir = path.join(app.getPath('userData'), 'printer-devmodes');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return path.join(dir, `${hash}.bin`);
}

// Abre Preferencias del driver para configurar una impresora — pero sobre
// una COPIA EN MEMORIA del DEVMODE. Las elecciones del usuario se guardan
// en un archivo local de PrintLayout, NO se escriben al DEVMODE del sistema.
// Comportamiento estilo Adobe Reader: lo que configures aca se usa solo en
// PrintLayout, sin pisar defaults de otras apps.
ipcMain.handle('print:open-printer-config', async (_evt, payload) => {
  const { deviceName } = payload ?? {};
  if (!deviceName || typeof deviceName !== 'string') {
    return { ok: false, error: 'Falta el nombre de la impresora.' };
  }
  const helperExe = resolvePrintHelper();
  if (!helperExe) {
    return { ok: false, error: 'No se encontro PrintHelper.exe.' };
  }
  const dmFile = devmodeFilePath(deviceName);

  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (r) => { if (settled) return; settled = true; resolve(r); };

    let proc;
    try {
      proc = spawn(helperExe, [], { windowsHide: false });
    } catch (err) {
      settle({ ok: false, error: `No se pudo iniciar PrintHelper: ${err.message}` });
      return;
    }

    proc.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    proc.on('error', (err) => settle({ ok: false, error: `PrintHelper fallo: ${err.message}` }));
    proc.on('close', (code) => {
      const result = {};
      for (const ln of stdout.split(/\r?\n/)) {
        const eq = ln.indexOf('=');
        if (eq <= 0) continue;
        result[ln.slice(0, eq)] = ln.slice(eq + 1);
      }
      if (result.OK === '1' && result.DEVMODE_OUT) {
        try {
          const buf = Buffer.from(result.DEVMODE_OUT, 'base64');
          fs.writeFileSync(dmFile, buf);
          settle({ ok: true, configured: true, bytes: buf.length });
        } catch (err) {
          settle({ ok: false, error: `No se pudo guardar DEVMODE: ${err.message}` });
        }
      } else if (result.CANCELED === '1' || code === 2) {
        settle({ ok: true, canceled: true });
      } else {
        const errMsg = result.ERROR || stderr.trim() || `PrintHelper exit ${code}`;
        settle({ ok: false, error: errMsg });
      }
    });

    // Input al helper.
    const lines = [
      'MODE=configure',
      `DEVICE=${deviceName}`,
    ];
    if (fs.existsSync(dmFile)) lines.push(`DEVMODE_FILE=${dmFile}`);
    lines.push('END=1');
    try {
      proc.stdin.write(lines.join('\n') + '\n', 'utf-8');
      proc.stdin.end();
    } catch (err) {
      settle({ ok: false, error: `No se pudo enviar input al helper: ${err.message}` });
    }
  });
});

// Permite resetear las preferencias guardadas por PrintLayout para una
// impresora (volver a usar los defaults del sistema).
ipcMain.handle('print:reset-printer-config', async (_evt, payload) => {
  const { deviceName } = payload ?? {};
  if (!deviceName) return { ok: false, error: 'Falta el nombre de la impresora.' };
  const dmFile = devmodeFilePath(deviceName);
  try {
    if (fs.existsSync(dmFile)) fs.unlinkSync(dmFile);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Indica si hay un DEVMODE guardado por PrintLayout para esta impresora.
ipcMain.handle('print:has-printer-config', async (_evt, payload) => {
  const { deviceName } = payload ?? {};
  if (!deviceName) return { ok: true, exists: false };
  const dmFile = devmodeFilePath(deviceName);
  return { ok: true, exists: fs.existsSync(dmFile) };
});

ipcMain.handle('print:pdf', async (_evt, payload) => {
  const {
    images,
    pageWidthMm,
    pageHeightMm,
    deviceName,
    copies,
    showDialog,
  } = payload ?? {};
  if (!Array.isArray(images) || images.length === 0) {
    return { ok: false, error: 'No hay paginas para imprimir.' };
  }
  if (!pageWidthMm || !pageHeightMm) {
    return { ok: false, error: 'Tamano de hoja no definido.' };
  }

  const helperExe = resolvePrintHelper();
  if (!helperExe) {
    return { ok: false, error: 'No se encontro PrintHelper.exe.' };
  }

  // Volcar cada hoja (dataURL PNG) a un archivo temporal. El helper carga
  // los PNG de disco — pasarlos por stdin junto al control complicaria el
  // protocolo y limitaria por buffer pipe de Windows.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printlayout-print-'));
  const pagePaths = [];
  try {
    for (let i = 0; i < images.length; i++) {
      const p = path.join(tmpDir, `page-${String(i).padStart(3, '0')}.png`);
      fs.writeFileSync(p, dataUrlToBuffer(images[i]));
      pagePaths.push(p);
    }
  } catch (err) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return { ok: false, error: `No se pudieron preparar las hojas: ${err.message}` };
  }

  // Construir input del helper. Ver protocolo en helper/PrintHelper.cs.
  const lines = ['MODE=print'];
  if (deviceName) lines.push(`DEVICE=${deviceName}`);
  if (typeof copies === 'number' && copies > 0) {
    lines.push(`COPIES=${Math.floor(copies)}`);
  }
  // Default: mostrar dialog (UX Adobe Reader). Caller puede pasar
  // showDialog:false para impresion silent.
  lines.push(`SHOW_DIALOG=${showDialog === false ? '0' : '1'}`);
  lines.push(`WIDTH_MM=${pageWidthMm}`);
  lines.push(`HEIGHT_MM=${pageHeightMm}`);
  // Si existe un DEVMODE guardado por PrintLayout para esta impresora, lo
  // pasamos para que el job use esas preferencias (papel/calidad/color/duplex).
  if (deviceName) {
    const dmFile = devmodeFilePath(deviceName);
    if (fs.existsSync(dmFile)) lines.push(`DEVMODE_FILE=${dmFile}`);
  }
  for (const p of pagePaths) lines.push(`PAGE=${p}`);
  lines.push('END=1');

  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      resolve(result);
    };

    let proc;
    try {
      proc = spawn(helperExe, [], { windowsHide: false });
    } catch (err) {
      settle({ ok: false, error: `No se pudo iniciar PrintHelper: ${err.message}` });
      return;
    }

    proc.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    proc.on('error', (err) => {
      settle({ ok: false, error: `PrintHelper fallo: ${err.message}` });
    });
    proc.on('close', (code) => {
      // Parsear key=value del stdout.
      const result = {};
      for (const ln of stdout.split(/\r?\n/)) {
        const eq = ln.indexOf('=');
        if (eq <= 0) continue;
        result[ln.slice(0, eq)] = ln.slice(eq + 1);
      }
      if (result.OK === '1') {
        settle({ ok: true });
      } else if (result.CANCELED === '1' || code === 2) {
        settle({ ok: false, canceled: true });
      } else {
        const errMsg = result.ERROR || stderr.trim() || `PrintHelper exit ${code}`;
        settle({ ok: false, error: errMsg });
      }
    });

    try {
      proc.stdin.write(lines.join('\n') + '\n', 'utf-8');
      proc.stdin.end();
    } catch (err) {
      settle({ ok: false, error: `No se pudo enviar input al helper: ${err.message}` });
    }
  });
});

function setupAutoUpdate(parentWin) {
  // Solo en builds packaged: en dev no hay app-update.yml.
  if (!app.isPackaged) return;

  autoUpdater.on('update-available', (info) => {
    parentWin?.webContents.send('updater:status', {
      kind: 'available',
      version: info?.version,
    });
  });
  autoUpdater.on('update-not-available', () => {
    parentWin?.webContents.send('updater:status', { kind: 'none' });
  });
  autoUpdater.on('download-progress', (p) => {
    parentWin?.webContents.send('updater:status', {
      kind: 'downloading',
      percent: Math.round(p.percent || 0),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    parentWin?.webContents.send('updater:status', {
      kind: 'ready',
      version: info?.version,
    });
  });
  autoUpdater.on('error', (err) => {
    parentWin?.webContents.send('updater:status', {
      kind: 'error',
      error: String(err?.message || err),
    });
  });

  // Chequeo inicial a los 3s (UI ya cargada) y despues cada 30 min.
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 30 * 60 * 1000);
}

ipcMain.handle('updater:install-now', () => {
  if (!app.isPackaged) return { ok: false, error: 'Solo en builds instalados.' };
  autoUpdater.quitAndInstall();
  return { ok: true };
});

ipcMain.handle('updater:check-now', async () => {
  if (!app.isPackaged) return { ok: false, error: 'Solo en builds instalados.' };
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, version: r?.updateInfo?.version };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

app.whenReady().then(() => {
  createWindow();
  const win = BrowserWindow.getAllWindows()[0];
  setupAutoUpdate(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
