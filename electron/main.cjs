const {
  app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { autoUpdater } = require('electron-updater');
const potrace = require('potrace');
const templatesStore = require('./templates-store.cjs');
const templatesSync = require('./templates-sync.cjs');
const paperPresetsStore = require('./paper-presets-store.cjs');
const paperPresetsSync = require('./paper-presets-sync.cjs');
const workStatesStore = require('./work-states-store.cjs');
const jobsStore = require('./jobs-store.cjs');
const openTabsStore = require('./open-tabs-store.cjs');
const rotulosStore = require('./rotulos-store.cjs');
const rotulosConfig = require('./rotulos-config-store.cjs');
const intakeService = require('./intake/service.cjs');
const supabase = require('./intake/supabase.cjs');
const qrCutServer = require('./qrcut/server.cjs');
const qrCutRelay = require('./qrcut/relay.cjs');
const { writePdfSilent, dobblePdfFileName, rotuloPdfFileName } = require('./intake/save-pdf.cjs');

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

// Ghostscript embebido (bundle en ghostscript/, ver scripts/setup-ghostscript.ps1).
// Se usa para "Reparar PDF (para Corel)": re-destila PDFs de Canva (limpia la
// estructura, re-embebe fuentes, saca protecciones) manteniendo vectores/textos
// editables, para que abran en CorelDRAW sin el "archivo bloqueado".
const GHOSTSCRIPT_DIR = resolveResourcePath('ghostscript');
function ghostscriptBin() {
  const exe = path.join(GHOSTSCRIPT_DIR, 'bin', 'gswin64c.exe');
  return fs.existsSync(exe) ? exe : null;
}
function runGhostscriptRepair(inPath, outPath) {
  return new Promise((resolve, reject) => {
    const gs = ghostscriptBin();
    if (!gs) {
      reject(new Error('El motor de PDF (Ghostscript) no está disponible en esta instalación.'));
      return;
    }
    // Rutas de recursos EXPLÍCITAS → GS portable, no depende de una instalación
    // del sistema ni del registro. CompatibilityLevel 1.4 mantiene la
    // transparencia viva (editable); /prepress = máxima calidad.
    const args = [
      `-I${path.join(GHOSTSCRIPT_DIR, 'lib')}`,
      `-I${path.join(GHOSTSCRIPT_DIR, 'Resource', 'Init')}`,
      `-I${path.join(GHOSTSCRIPT_DIR, 'Resource')}`,
      `-I${path.join(GHOSTSCRIPT_DIR, 'iccprofiles')}`,
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      '-dPDFSETTINGS=/prepress',
      '-dDetectDuplicateImages=true',
      '-dNOPAUSE', '-dBATCH', '-dQUIET',
      `-sOutputFile=${outPath}`,
      inPath,
    ];
    let proc;
    try {
      proc = spawn(gs, args, { windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Ghostscript salió con código ${code}: ${stderr.slice(0, 400)}`));
        return;
      }
      resolve();
    });
  });
}

// Ícono de la app (bandeja + ventana). PNG 32×32 embebido en base64: el proyecto
// no trae archivo de ícono, así el ícono es autocontenido (dev e instalado) y no
// depende de configurar el build.
const APP_ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAZUlEQVR4nO3RMQ4AIAgDQCf/'
  + '/xpf4n90cgUkYDFpEyYTepHWmMrpY66IgRW7INKCE++7CQEFaF8YARARBJQBZOUfAPwEBBA'
  + 'AB2TlHwD8BATAABoiAiCWlwBYTuEdU3kG5LqYeZkNxYpURqvulikAAAAASUVORK5CYII=';
function appIconImage() {
  try {
    const img = nativeImage.createFromDataURL(`data:image/png;base64,${APP_ICON_B64}`);
    return img.isEmpty() ? nativeImage.createEmpty() : img;
  } catch (_) {
    return nativeImage.createEmpty();
  }
}

let mainWindow = null;
let tray = null;
let trayBalloonShown = false;
// app.isQuitting = true SÓLO en un cierre real (menú "Salir" o instalar update).
// La X esconde en la bandeja; este flag hace que el 'close' deje cerrar de verdad.
app.isQuitting = false;

let dirtyTabCount = 0;

// El renderer reporta cuántas tabs tienen cambios sin guardar. Lo usamos al
// SALIR de verdad para avisar (el cierre no depende del renderer).
ipcMain.on('app:dirty-count', (_evt, n) => {
  dirtyTabCount = Math.max(0, Number(n) || 0);
});

// Instancia única: si ya hay una corriendo (en la bandeja) y el operario hace
// doble clic en el acceso directo, esta segunda instancia se cierra y le pide a
// la primera que muestre/enfoque su ventana (no abre una segunda).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}

// Muestra/enfoca la ventana principal (desde el tray, el segundo-instance, etc.).
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Cierre REAL (menú "Salir"). Avisa si hay cambios sin guardar (que igual se
// auto-guardan y restauran al reabrir). Cancelar → sigue viva en la bandeja.
function quitApp() {
  if (dirtyTabCount > 0 && mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Salir', 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'Cambios sin guardar',
      message: `Hay ${dirtyTabCount} trabajo${dirtyTabCount === 1 ? '' : 's'} con cambios sin guardar.`,
      detail: 'Se guardan automáticamente y se restauran al reabrir la app.',
    });
    if (choice !== 0) return; // Cancelar → no salir
  }
  app.isQuitting = true;
  app.quit();
}

// Ícono en la bandeja del sistema. Clic (o doble clic) → mostrar la ventana.
// Menú contextual → Abrir / Salir. Si crear la bandeja falla, NO dejamos la app
// inaccesible (oculta sin ícono): mostramos la ventana como fallback.
function createTray() {
  if (tray) return;
  try {
    tray = new Tray(appIconImage());
    tray.setToolTip('PrintLayout');
    const menu = Menu.buildFromTemplate([
      { label: 'Abrir PrintLayout', click: () => showMainWindow() },
      { type: 'separator' },
      { label: 'Salir', click: () => quitApp() },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => showMainWindow());
    tray.on('double-click', () => showMainWindow());
  } catch (err) {
    console.error('No se pudo crear el ícono de bandeja:', err);
    tray = null;
    showMainWindow();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0b0d10',
    title: 'PrintLayout',
    icon: appIconImage(),
    // Arranca OCULTA: la app vive en la bandeja. El renderer igual se carga, así
    // el trabajo de fondo (intake de fotos, server QR) corre con la ventana oculta.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Que Chromium NO frene los timers del renderer cuando la ventana está
      // oculta: el armado de pedidos del intake corre en el renderer y tiene que
      // funcionar a pleno aunque no se vea la ventana.
      backgroundThrottling: false,
    },
  });
  const win = mainWindow;

  // La X ESCONDE en la bandeja, no cierra. Solo cierra de verdad cuando
  // app.isQuitting = true (menú "Salir" o instalar update). Así el trabajo de
  // fondo sigue corriendo y el instalador puede cerrar la app sin depender del
  // renderer (el flag hace que el 'close' no se cancele).
  win.on('close', (e) => {
    if (app.isQuitting) return;
    e.preventDefault();
    win.hide();
    // La primera vez, avisamos dónde quedó (globo de la bandeja).
    if (!trayBalloonShown) {
      trayBalloonShown = true;
      try {
        tray?.displayBalloon({
          title: 'PrintLayout sigue corriendo',
          content: 'Quedó en la bandeja (al lado del reloj). Clic en el ícono para volver a abrirla.',
        });
      } catch (_) { /* el globo no está soportado en este SO */ }
    }
  });

  win.on('closed', () => { mainWindow = null; });

  if (isDev) {
    win.loadURL('http://localhost:5174');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Conveniencia para probar localmente: con PRINTLAYOUT_DEV_SHOW=1 la ventana se
  // abre al arrancar (en producción la app arranca oculta en la bandeja). No
  // afecta al build normal instalado.
  if (process.env.PRINTLAYOUT_DEV_SHOW) {
    win.once('ready-to-show', () => { win.show(); win.focus(); });
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

// Registro de diagnóstico (temporal) para cazar bugs de uso intermitentes
// (p.ej. pestañas que se vacían al abrir un .pljob). Escribe líneas con hora a
// userData/state-debug.log. Fire-and-forget (send, no invoke) para no frenar la
// UI. Rota el archivo si pasa ~4MB. QUITAR cuando se encuentre la causa raíz.
const DEBUG_LOG_PATH = path.join(app.getPath('userData'), 'state-debug.log');
ipcMain.on('debug:log', (_evt, msg) => {
  try {
    try {
      const st = fs.statSync(DEBUG_LOG_PATH);
      if (st.size > 4 * 1024 * 1024) {
        // Conservar la cola (lo más reciente) y descartar el principio.
        const buf = fs.readFileSync(DEBUG_LOG_PATH);
        fs.writeFileSync(DEBUG_LOG_PATH, buf.subarray(buf.length - 1024 * 1024));
      }
    } catch (_) { /* archivo nuevo */ }
    fs.appendFileSync(DEBUG_LOG_PATH, `${new Date().toISOString()} ${msg}\n`);
  } catch (_) { /* best-effort */ }
});

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
    // Si el usuario escribió "carpeta\archivo" (o eligió una carpeta que aún no
    // existe), la creamos nosotros. Así puede armar la carpeta desde el campo
    // "Nombre" sin usar el botón "Nueva carpeta" del diálogo de Windows, que a
    // veces se traba con "carpeta en uso" (lo bloquea el antivirus al crearla).
    fs.mkdirSync(path.dirname(result.filePath), { recursive: true });
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

// Importar mazo Dobble: abre el JSON `recta-dobble-deck` y, si es modo 'assets',
// resuelve cada ref de simbolo a dataUrl leyendo los archivos al lado del JSON
// (o en una subcarpeta assets/). Devuelve la receta lista para renderizar inline.
function mimeDeExt(p) {
  const ext = String(p || '').toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'gif') return 'image/gif';
  return 'image/png';
}
function leerAssetDataUrl(dir, ref) {
  const candidatos = [
    path.join(dir, ref),
    path.join(dir, 'assets', ref),
    path.join(dir, 'simbolos', ref),
  ];
  for (const c of candidatos) {
    try {
      if (fs.existsSync(c)) {
        const buf = fs.readFileSync(c);
        return `data:${mimeDeExt(c)};base64,${buf.toString('base64')}`;
      }
    } catch (_) { /* probar siguiente */ }
  }
  return null;
}
ipcMain.handle('dobble:import-recipe', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Importar mazo Dobble (recta-dobble-deck.json)…',
      properties: ['openFile'],
      filters: [
        { name: 'Mazo Dobble', extensions: ['json', 'recta-dobble-deck'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    const dir = path.dirname(filePath);
    const receta = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Resolver assets → dataUrl (si la receta vino en modo 'assets').
    if (receta && receta.modo === 'assets' && Array.isArray(receta.simbolos)) {
      const faltan = [];
      receta.simbolos = receta.simbolos.map((s, i) => {
        if (s && s.dataUrl) return s; // ya inline
        const ref = s && (s.ref ?? s.url ?? s.v);
        if (!ref) { faltan.push(`simbolo ${i} (sin ref)`); return s; }
        const dataUrl = leerAssetDataUrl(dir, ref);
        if (!dataUrl) { faltan.push(String(ref)); return s; }
        return { tipo: 'img', dataUrl };
      });
      receta.modo = 'inline';
      if (faltan.length) {
        return { ok: false, error: `No se encontraron assets: ${faltan.slice(0, 8).join(', ')}${faltan.length > 8 ? '…' : ''}` };
      }
    }
    return { ok: true, path: filePath, receta };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Sobreescribe un job en un path conocido (Ctrl+S despues de un Save As).
ipcMain.handle('jobs:save-to-path', async (_evt, { path: filePath, payload }) => {
  try {
    if (!filePath) return { ok: false, error: 'path vacio' };
    // Crear la carpeta destino si no existe (p. ej. la subcarpeta "Pedidos" del
    // modo de entrega en carpeta del intake).
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
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

    // Propagacion de borrados: si una plantilla local vino del repo (tiene
    // sharedAt) pero su id ya NO esta en el manifest remoto, es porque se
    // borro "de todas las PCs". La sacamos tambien aca.
    // Guarda de seguridad: solo cuando el remoto trajo al menos una plantilla,
    // asi un manifest vacio o un 404 por red caida no borra todo lo compartido.
    const removed = [];
    if (remote.length > 0) {
      const remoteIds = new Set(remote.map((e) => e.id));
      for (const t of templatesStore.list()) {
        if (t.sharedAt && !remoteIds.has(t.id)) {
          templatesStore.remove(t.id);
          removed.push({ id: t.id, name: t.name });
        }
      }
    }

    return { ok: true, added, updated, replaced, cleaned, removed, errors };
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

// templates:delete-shared => borra una plantilla del repo compartido (todas las
// PCs) y tambien de esta PC. Requiere token. Las otras PCs la pierden en su
// proximo sync (el pull propaga la ausencia del manifest).
ipcMain.handle('templates:delete-shared', async (_evt, id) => {
  try {
    if (!templatesSync.hasToken()) {
      return { ok: false, error: 'Esta PC no puede borrar plantillas compartidas (sin permiso de escritura).' };
    }
    const r = await templatesSync.deleteTemplate(id);
    if (!r.ok) return r;
    // Sacar tambien la copia local de esta PC.
    templatesStore.remove(id);
    return { ok: true };
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

// Renderiza las PIEZAS de un PDF: cada imagen embebida se rinde recortando su
// region de la pagina, asi el resultado incluye lo que este ENCIMA (mascaras de
// transparencia, texto/logos vectoriales). Resuelve el caso "tira de stickers
// donde las imagenes embebidas salen en blanco" (el fondo es un raster y la
// mascara/diseno va aparte). Misma metadata que extract para reusar el flujo.
ipcMain.handle('pdf:render-regions', async (_evt, payload) => {
  const bytes = payload?.bytes ?? payload;
  const dpi = Number(payload?.dpi) || 300;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printlayout-regions-'));
  const tmpPdf = path.join(tmpDir, 'source.pdf');
  const outDir = path.join(tmpDir, 'images');
  try {
    fs.writeFileSync(tmpPdf, Buffer.from(bytes));
    fs.mkdirSync(outDir);
    const { stdout } = await runPython('render_pdf_regions.py', { args: [tmpPdf, outDir, String(dpi)] });
    let parsed;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch (e) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      return { ok: false, error: `Salida invalida del renderizador: ${e.message}` };
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
    // Exigir separador: startsWith(root) a secas dejaría pasar una carpeta
    // hermana como "<tmp>-otra". Aceptar solo el root o algo dentro de él
    // (mismo patrón que intake/service.cjs readFile).
    const root = path.resolve(os.tmpdir());
    const resolved = path.resolve(filePath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return { ok: false, error: 'path fuera de tmpdir' };
    }
    const buf = fs.readFileSync(resolved);
    return { ok: true, bytes: buf };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('pdf:cleanup-extracted', async (_evt, payload) => {
  try {
    const dir = payload?.tmpDir;
    if (!dir) return { ok: false };
    const root = path.resolve(os.tmpdir());
    const resolved = path.resolve(dir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return { ok: false };
    fs.rmSync(resolved, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------------------------------------------------------------------------
// Rotulos escolares — Fase 1 (CARGAR): tipografias + modelos.
// Solo carga y cataloga; la generacion (texto auto-ajustado, plancha, corte, QR)
// va en una orden posterior.
// ---------------------------------------------------------------------------
let _fontkit;
function getFontkit() {
  if (_fontkit === undefined) {
    try { _fontkit = require('fontkit'); } catch (_) { _fontkit = null; }
  }
  return _fontkit;
}

ipcMain.handle('rotulos:fonts-list', () => rotulosStore.listFonts());

// Elige una fuente .ttf/.otf, la valida con fontkit, la copia a userData y la
// registra. Devuelve la familia detectada para mostrarla en la lista.
ipcMain.handle('rotulos:font-add', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const pick = await dialog.showOpenDialog(win, {
      title: 'Elegir tipografía (.ttf / .otf)',
      properties: ['openFile'],
      filters: [
        { name: 'Fuentes', extensions: ['ttf', 'otf', 'ttc'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    });
    if (pick.canceled || !pick.filePaths?.[0]) return { canceled: true };
    const srcPath = pick.filePaths[0];
    const ext = (path.extname(srcPath).slice(1).toLowerCase()) || 'ttf';

    // Validar + extraer familia.
    let familia = path.basename(srcPath, path.extname(srcPath));
    const fk = getFontkit();
    if (fk) {
      let font;
      try {
        font = fk.openSync(srcPath);
      } catch (err) {
        return { ok: false, error: `El archivo no es una fuente válida: ${err.message}` };
      }
      const f = font && font.fonts ? font.fonts[0] : font; // .ttc -> coleccion
      familia = (f && (f.familyName || f.fullName || f.postscriptName)) || familia;
    }

    rotulosStore.ensureDirs();
    const id = rotulosStore.generateId('font');
    const destPath = path.join(rotulosStore.fontsDir(), `${id}.${ext}`);
    fs.copyFileSync(srcPath, destPath);
    const entry = rotulosStore.addFont({ id, familia, archivo: destPath, ext });
    return { ok: true, font: entry };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('rotulos:font-remove', (_evt, id) => {
  try {
    // PORTABILIDAD: borra reconstruyendo la ruta desde fontsDir() (no del
    // 'archivo' absoluto guardado, que en otra PC no existe), con guarda.
    const font = rotulosStore.listFonts().find((f) => f.id === id);
    if (font) {
      const ext = (font.ext || 'ttf').toLowerCase();
      const root = path.resolve(rotulosStore.rotulosDir());
      const resolved = path.resolve(path.join(rotulosStore.fontsDir(), `${id}.${ext}`));
      if (resolved.startsWith(root + path.sep)) {
        try { fs.rmSync(resolved, { force: true }); } catch (_) { /* best-effort */ }
      }
    }
    return rotulosStore.removeFont(id);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('rotulos:models-list', () => rotulosStore.listModels());

// Guarda el modelo: escribe las imágenes (dataURL -> archivo full-res) al catálogo
// y persiste la entrada con la caja de texto dibujada a mano (mm, relativa al
// rótulo). Un modelo = 3 imágenes sueltas (grande/intermedio/chico), NO PDF. En
// edición, reescribe el directorio del modelo desde cero.
// Escribe un archivo reintentando ante bloqueos TRANSITORIOS (EPERM/EBUSY/EACCES),
// típicos cuando la carpeta está en OneDrive/Escritorio, la escanea un antivirus o
// el archivo quedó abierto en un visor. Espera incremental entre intentos.
async function writeFileRetry(filePath, data, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      fs.writeFileSync(filePath, data);
      return;
    } catch (err) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code) || i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 120 * (i + 1)));
    }
  }
}

ipcMain.handle('rotulos:model-save', async (_evt, payload) => {
  try {
    const { id: reqId, nombre, thumb, sizes, arteIncluyeRecuadro } = payload || {};
    if (!sizes || Object.keys(sizes).length === 0) {
      return { ok: false, error: 'Subí al menos una imagen para guardar el modelo.' };
    }
    rotulosStore.ensureDirs();
    const id = reqId || rotulosStore.generateId('rot');
    const dir = rotulosStore.modelDir(id);
    // Sobrescribir EN EL LUGAR (no borrar+recrear la carpeta). En Windows el
    // borrado es ASÍNCRONO: si borrás un archivo/carpeta y enseguida escribís uno
    // con el MISMO nombre, el SO todavía lo tiene en "borrado pendiente" y tira
    // EPERM. Eso pasaba SOLO al EDITAR (los artes ya existen); al crear un modelo
    // nuevo la carpeta no existe y no hay carrera. Por eso: mkdir si falta,
    // writeFile PISA el archivo existente (truncate, sin recrear la entrada de
    // directorio) y al final se podan los artes viejos que ya no correspondan.
    fs.mkdirSync(dir, { recursive: true });

    const savedSizes = {};
    const keepFiles = new Set();
    for (const [key, s] of Object.entries(sizes)) {
      if (!s || !s.dataUrl) continue;
      const ext = (s.ext || 'png').toLowerCase();
      const arteFile = `${key}.${ext}`;
      await writeFileRetry(path.join(dir, arteFile), dataUrlToBuffer(s.dataUrl));
      keepFiles.add(arteFile);
      savedSizes[key] = {
        arteFile,
        artePath: path.join(dir, arteFile),
        ext,
        wPx: s.wPx || null,
        hPx: s.hPx || null,
        cutMm: s.cutMm || null,     // {w,h,radius} fijo del tamaño
        textBox: s.textBox || null, // {x,y,w,h,rotation} en mm/grados, relativa al rótulo
      };
    }
    // Podar artes viejos que ya no van (tamaño quitado, o cambió el formato
    // png<->jpg). Son nombres DISTINTOS a los recién escritos, así que borrarlos no
    // recrea nada → sin carrera de "borrado pendiente".
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!keepFiles.has(f)) { try { fs.rmSync(path.join(dir, f), { force: true }); } catch (_) { /* noop */ } }
      }
    } catch (_) { /* noop */ }
    if (Object.keys(savedSizes).length === 0) {
      return { ok: false, error: 'No se pudo leer ninguna imagen del modelo.' };
    }

    const model = rotulosStore.saveModel({
      id,
      nombre: nombre || 'Modelo',
      arteIncluyeRecuadro: !!arteIncluyeRecuadro,
      thumb: thumb || null,
      sizes: savedSizes,
    });
    return { ok: true, model };
  } catch (err) {
    const locked = ['EPERM', 'EBUSY', 'EACCES'].includes(err.code);
    const arch = err.path ? path.basename(err.path) : 'la imagen';
    const msg = locked
      ? `No se pudo guardar ${arch}: el archivo está bloqueado (abierto en otro programa, o sincronizándose por OneDrive/antivirus). Cerrá la imagen si la tenés abierta y probá de nuevo. Si sigue, conviene mover el catálogo de rótulos a una carpeta que NO esté en OneDrive/Escritorio.`
      : err.message;
    return { ok: false, error: msg };
  }
});

ipcMain.handle('rotulos:model-remove', (_evt, id) => {
  try {
    const dir = rotulosStore.modelDir(id);
    const root = path.resolve(rotulosStore.modelsDir());
    const resolved = path.resolve(dir);
    if (resolved.startsWith(root + path.sep)) {
      try { fs.rmSync(resolved, { recursive: true, force: true }); } catch (_) { /* noop */ }
    }
    return rotulosStore.removeModel(id);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Lee un arte ya guardado como dataURL (para el preview del listado y la edición).
// PORTABILIDAD: recibe { modelId, arteFile } y RECONSTRUYE la ruta desde la base
// actual (rotulosDir), así el modelo es portable entre PC (la ruta absoluta
// guardada por otra PC no existe acá). Acepta un string absoluto como legacy.
ipcMain.handle('rotulos:read-image', (_evt, arg) => {
  try {
    const root = path.resolve(rotulosStore.rotulosDir());
    let resolved;
    if (arg && typeof arg === 'object' && arg.modelId && arg.arteFile) {
      resolved = path.resolve(path.join(rotulosStore.modelDir(arg.modelId), arg.arteFile));
    } else if (typeof arg === 'string' && arg) {
      resolved = path.resolve(arg); // legacy: ruta absoluta
    } else {
      return { ok: false, error: 'parámetros inválidos' };
    }
    if (!resolved.startsWith(root + path.sep)) {
      return { ok: false, error: 'path fuera de rótulos' };
    }
    const buf = fs.readFileSync(resolved);
    const ext = path.extname(resolved).slice(1).toLowerCase();
    const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png';
    return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Lee los bytes de una tipografía (dataURL). PORTABILIDAD: RECONSTRUYE la ruta
// desde fontsDir() + <id>.<ext> (no usa el 'archivo' absoluto guardado, que en
// otra PC no existe). Mantiene la guarda de estar dentro de rotulosDir().
ipcMain.handle('rotulos:read-font', (_evt, id) => {
  try {
    const font = rotulosStore.listFonts().find((f) => f.id === id);
    if (!font) return { ok: false, error: 'Fuente no encontrada.' };
    const ext = (font.ext || 'ttf').toLowerCase();
    const root = path.resolve(rotulosStore.rotulosDir());
    const resolved = path.resolve(path.join(rotulosStore.fontsDir(), `${id}.${ext}`));
    if (!resolved.startsWith(root + path.sep)) {
      return { ok: false, error: 'path fuera de rótulos' };
    }
    if (!fs.existsSync(resolved)) return { ok: false, error: 'Fuente no encontrada.' };
    const buf = fs.readFileSync(resolved);
    const mime = ext === 'otf' ? 'font/otf' : 'font/ttf';
    return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}`, ext };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- Config del catálogo de rótulos (carpeta compartida) ---
ipcMain.handle('rotulos:get-config', () => rotulosConfig.load());
ipcMain.handle('rotulos:set-config', (_evt, patch) => {
  try {
    return { ok: true, config: rotulosConfig.save(patch) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('rotulos:choose-dir', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const r = await dialog.showOpenDialog(win, {
      title: 'Carpeta compartida del catálogo de rótulos',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
    return { ok: true, path: r.filePaths[0] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Publica el catálogo de modelos a la web (Supabase: tabla modelos_rotulos +
// bucket público rotulos-modelos). Reusa la config Supabase del intake. TODO en
// main: la service key NUNCA sale al renderer ni se loguea. Idempotente (upsert
// por id, x-upsert en Storage). No corta si un modelo falla: sigue y reporta.
ipcMain.handle('rotulos:publish-web', async () => {
  try {
    const cfg = intakeService.getConfig();
    if (!cfg?.supabaseUrl || !cfg?.serviceKey) {
      return { ok: false, error: 'Configurá Supabase (URL + service key) en el panel de entrada de pedidos.' };
    }
    const SIZE_KEYS = ['grande', 'intermedio', 'chico'];
    const models = rotulosStore.listModels();
    const result = {
      total: models.length,
      publicados: 0,
      saltados: [],
      errores: [],
      // Tipografías (bucket rotulos-fuentes + tabla tipografias_rotulos).
      fuentesTotal: 0,
      fuentesPublicadas: 0,
      fuentesErrores: [],
    };

    for (let i = 0; i < models.length; i++) {
      const m = models[i];
      try {
        const sizes = {};
        let anyArt = false;
        for (const key of SIZE_KEYS) {
          const s = m.sizes?.[key];
          if (!s?.arteFile) continue;
          const ext = (s.ext || 'png').toLowerCase();
          // PORTABILIDAD: ruta reconstruida desde la base actual (local o compartida).
          const filePath = path.join(rotulosStore.modelDir(m.id), s.arteFile);
          if (!fs.existsSync(filePath)) continue;
          const buf = fs.readFileSync(filePath);
          const contentType = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png';
          const objectPath = `${m.id}/${key}.${ext}`;
          await supabase.uploadPublicObject(cfg, 'rotulos-modelos', objectPath, buf, contentType);
          sizes[key] = {
            arte_url: supabase.publicObjectUrl(cfg, 'rotulos-modelos', objectPath),
            textBox: s.textBox || null,
            cutMm: s.cutMm || null,
          };
          anyArt = true;
        }
        if (!anyArt) { result.saltados.push({ nombre: m.nombre || m.id, motivo: 'sin arte' }); continue; }

        // numero = con el que el cliente busca en "Nuevo trabajo" (hoy = nombre).
        const row = {
          id: m.id,
          numero: m.numero || m.nombre || '',
          nombre: m.nombre || '',
          sizes,
          arte_incluye_recuadro: !!m.arteIncluyeRecuadro,
          activo: true,
          orden: Number.isFinite(m.orden) ? m.orden : i,
        };
        await supabase.upsertModelosRotulos(cfg, [row]); // por modelo → aísla fallas
        result.publicados += 1;
      } catch (e) {
        result.errores.push({ nombre: m.nombre || m.id, error: e.message });
      }
    }

    // --- Tipografías: bucket `rotulos-fuentes` + tabla `tipografias_rotulos`. ---
    const fonts = rotulosStore.listFonts();
    result.fuentesTotal = fonts.length;
    for (let i = 0; i < fonts.length; i++) {
      const fnt = fonts[i];
      try {
        const ext = (fnt.ext || 'ttf').toLowerCase();
        // PORTABILIDAD: ruta reconstruida desde fontsDir() + <id>.<ext> (igual que
        // rotulos:read-font), no el `archivo` absoluto guardado.
        const filePath = path.join(rotulosStore.fontsDir(), `${fnt.id}.${ext}`);
        if (!fs.existsSync(filePath)) {
          result.fuentesErrores.push({ familia: fnt.familia || fnt.id, error: 'archivo no encontrado' });
          continue;
        }
        const buf = fs.readFileSync(filePath);
        const contentType = ext === 'otf' ? 'font/otf' : (ext === 'ttc' ? 'font/collection' : 'font/ttf');
        const objectPath = `${fnt.id}.${ext}`;
        await supabase.uploadPublicObject(cfg, 'rotulos-fuentes', objectPath, buf, contentType);
        const row = {
          id: fnt.id,
          familia: fnt.familia || fnt.id,
          archivo_url: supabase.publicObjectUrl(cfg, 'rotulos-fuentes', objectPath),
          ext,
          activo: true,
          orden: Number.isFinite(fnt.orden) ? fnt.orden : i,
        };
        await supabase.upsertTipografiasRotulos(cfg, [row]); // por fuente → aísla fallas
        result.fuentesPublicadas += 1;
      } catch (e) {
        result.fuentesErrores.push({ familia: fnt.familia || fnt.id, error: e.message });
      }
    }

    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Publica un mazo Dobble a la web /busca2 de una: guarda el PDF ya armado en un
// lugar estable (userData/busca2-mazos/<id>.pdf), lo registra en el mapa
// mazo_id→PDF (para que el exportador automático de pedidos lo copie), sube la
// preview al bucket público `mazos-busca2` (path <id>.png, x-upsert) y hace
// upsert de la ficha en la tabla `mazos_busca2`. TODO en main: la service key
// NUNCA sale al renderer ni se loguea. Idempotente (mismo id pisa todo).
ipcMain.handle('busca2:publish-mazo', async (_evt, payload = {}) => {
  try {
    const { id, nombre, descripcion, orden, pdfBytes, previewDataUrl } = payload;
    const mazoId = String(id || '').trim();
    const name = String(nombre || '').trim();
    if (!mazoId) return { ok: false, error: 'Falta el identificador del mazo.' };
    if (!name) return { ok: false, error: 'El nombre es obligatorio.' };
    if (!pdfBytes) return { ok: false, error: 'No hay PDF del mazo para guardar.' };
    if (!previewDataUrl) return { ok: false, error: 'No hay imagen de preview del mazo.' };

    const cfg = intakeService.getConfig();
    if (!cfg?.supabaseUrl || !cfg?.serviceKey) {
      return { ok: false, error: 'Configurá Supabase (URL + service key) en el panel de entrada de pedidos.' };
    }

    // 1) Guardar el PDF en una ubicación estable + registrar mazo_id → PDF.
    const pdfPath = path.join(app.getPath('userData'), 'busca2-mazos', `${mazoId}.pdf`);
    writePdfSilent(pdfPath, Buffer.from(pdfBytes));
    intakeService.setConfig({
      dobbleMazoPdfMap: { ...(cfg.dobbleMazoPdfMap || {}), [mazoId]: pdfPath },
    });

    // 2) Subir la preview al bucket público (pisa con x-upsert).
    const previewObjectPath = `${mazoId}.png`;
    await supabase.uploadPublicObject(
      cfg, 'mazos-busca2', previewObjectPath, dataUrlToBuffer(previewDataUrl), 'image/png',
    );
    const previewUrl = supabase.publicObjectUrl(cfg, 'mazos-busca2', previewObjectPath);

    // 3) Upsert de la ficha del catálogo. precio_id null → la web usa armado-31.
    const ordenNum = Number.isFinite(Number(orden)) ? Math.floor(Number(orden)) : 0;
    const row = {
      id: mazoId,
      nombre: name,
      // La columna descripcion es NOT NULL → vacío = '' (nunca null).
      descripcion: (descripcion && String(descripcion).trim()) || '',
      preview_path: previewUrl,
      precio_id: null,
      activo: true,
      orden: ordenNum,
    };
    await supabase.upsertMazosBusca2(cfg, [row]);

    return { ok: true, previewUrl, pdfPath, id: mazoId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Migración one-shot: copia el catálogo LOCAL (userData/rotulos) a la carpeta
// compartida configurada. Explícito (botón), no automático. Si el destino ya
// tiene índice, NO pisa salvo overwrite:true (el renderer avisa antes).
ipcMain.handle('rotulos:migrate-to-shared', (_evt, { overwrite = false } = {}) => {
  try {
    const localBase = path.join(app.getPath('userData'), 'rotulos');
    const shared = rotulosConfig.load().rotulosSharedDir;
    if (!shared) return { ok: false, error: 'No hay carpeta compartida configurada.' };
    const dest = path.resolve(shared);
    if (path.resolve(localBase) === dest) return { ok: false, error: 'La carpeta compartida es la misma que la local.' };
    if (!fs.existsSync(localBase)) return { ok: false, error: 'No hay catálogo local para copiar.' };

    fs.mkdirSync(dest, { recursive: true });
    const destModelsIdx = path.join(dest, 'models-index.json');
    const destFontsIdx = path.join(dest, 'fonts-index.json');
    if (!overwrite && (fs.existsSync(destModelsIdx) || fs.existsSync(destFontsIdx))) {
      return { ok: false, needsOverwrite: true, error: 'La carpeta compartida ya tiene un catálogo.' };
    }

    // Índices + carpetas completas (recursive). last-write-wins, sin locking
    // (aceptado: no se crean 2 iguales al mismo tiempo).
    for (const f of ['fonts-index.json', 'models-index.json']) {
      const src = path.join(localBase, f);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(dest, f));
    }
    for (const d of ['fonts', 'models']) {
      const src = path.join(localBase, d);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(dest, d), { recursive: true });
    }
    const models = rotulosStore.listModels().length; // ya lee de la base compartida
    const fonts = rotulosStore.listFonts().length;
    return { ok: true, models, fonts, dest };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Guarda silencioso el PDF de la plancha de rótulos en una carpeta de salida y lo
// abre (clona intake:save-photo-pdf / writePdfSilent).
ipcMain.handle('rotulos:save-pdf', async (_evt, { defaultName, bytes }) => {
  try {
    const dir = path.join(app.getPath('documents'), 'PrintLayout Rotulos');
    const safe = String(defaultName || 'rotulos')
      .replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, ' ').trim() || 'rotulos';
    const filePath = path.join(dir, `${safe}.pdf`);
    writePdfSilent(filePath, Buffer.from(bytes));
    await shell.openPath(filePath).catch(() => {});
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('plotter:send-cut', async (_evt, payload) => {
  // La IP/puerto del plotter salen de la config del Servidor QR (única fuente de
  // verdad), salvo que el payload los traiga explícitos. Así el envío directo y
  // el corte por QR apuntan siempre al mismo lugar.
  const qrCfg = qrCutServer.getConfig();
  const merged = {
    ...payload,
    ip: payload?.ip || qrCfg.plotterIP,
    puerto: payload?.puerto || qrCfg.plotterPort,
  };
  // Coexistencia: tomamos el CANDADO ÚNICO del plotter (encola si el server QR o
  // el relay lo tienen) mientras dura el envío directo, y lo liberamos al final.
  // Así el envío directo local nunca se solapa con el relay ni con el QR.
  let plotterToken = null;
  if (!merged.dryRun) {
    try { plotterToken = await qrCutServer.acquirePlotter('directo-local'); } catch (_) { /* best-effort */ }
  }
  try {
    const stdin = JSON.stringify(merged);
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
  } finally {
    if (plotterToken) {
      try { qrCutServer.releasePlotter(plotterToken); } catch (_) { /* best-effort */ }
      plotterToken = null;
    }
  }
});

// Exportar el corte como .plt a la carpeta del server QR (en vez de enviarlo por
// socket). El caller arma outPath = <cortesDir>/<cutId>.plt. NO hay conexión
// directa al plotter acá (solo se escribe un archivo), así que NO se pausa el
// server QR. Mismo payload TB26 que el envío directo.
ipcMain.handle('plotter:export-cut', async (_evt, payload) => {
  if (!payload || !payload.outPath) {
    return { ok: false, error: 'Falta la ruta de salida (outPath).' };
  }
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

// Corte BASE por plancha (pedidos de fotos): asegura que exista
// <cortesDir>/<planchaId>.plt en la carpeta del server QR. Si ya está, NO lo
// regenera (evita pisarlo si el plotter lo está sirviendo en ese momento). Si
// falta, lo genera una vez desde los `cortes` de la plancha (mismo camino que
// el .plt manual). Todas las hojas de la plancha comparten este corte.
ipcMain.handle('qrcut:ensure-base-cut', async (_evt, payload) => {
  try {
    const planchaId = String(payload?.planchaId || '').replace(/[^A-Za-z0-9_-]/g, '');
    if (!planchaId) return { ok: false, error: 'planchaId inválido.' };
    if (!Array.isArray(payload?.cortes) || payload.cortes.length === 0) {
      return { ok: false, error: 'La plancha no tiene cortes.' };
    }
    const cfg = qrCutServer.getConfig();
    const dir = (cfg && cfg.cortesDir ? String(cfg.cortesDir) : '').trim();
    if (!dir) return { ok: false, error: 'No hay carpeta de cortes configurada.' };
    const outPath = path.join(dir, `${planchaId}.plt`);
    // Firma de los parámetros que definen el corte. Si el .plt ya existe pero se
    // generó con OTROS parámetros (típico: cambió el margen de marcas de 10 a 25),
    // hay que REGENERARLO, sino el corte servido por QR no coincide con las marcas
    // impresas. El nombre del .plt es fijo (= texto del QR) y no se puede versionar,
    // así que guardamos la firma en un sidecar <planchaId>.plt.json (el server QR
    // resuelve por nombre exacto, nunca pide el .json → es inofensivo).
    const sigPath = `${outPath}.json`;
    const sig = crypto.createHash('md5').update(JSON.stringify({
      m: payload.markMarginMm,
      w: payload.pageWidthMm,
      h: payload.pageHeightMm,
      b: payload.bladeOffsetMm,
      c: payload.cortes,
    })).digest('hex');
    if (fs.existsSync(outPath)) {
      let prevSig = null;
      try { prevSig = JSON.parse(fs.readFileSync(sigPath, 'utf8')).sig; } catch { /* sin sidecar → regenerar */ }
      if (prevSig === sig) {
        return { ok: true, existed: true, path: outPath };
      }
    }
    const stdin = JSON.stringify({
      cortes: payload.cortes,
      pageWidthMm: payload.pageWidthMm,
      pageHeightMm: payload.pageHeightMm,
      markMarginMm: payload.markMarginMm,
      bladeOffsetMm: payload.bladeOffsetMm,
      outPath,
    });
    const { stdout } = await runPython('send_to_plotter.py', { stdin });
    let result;
    try {
      result = JSON.parse(stdout.trim());
    } catch (e) {
      return { ok: false, error: `Salida inválida del sender: ${e.message}` };
    }
    if (result && result.ok) {
      try { fs.writeFileSync(sigPath, JSON.stringify({ sig, markMarginMm: payload.markMarginMm })); } catch { /* best-effort */ }
    }
    return { ...result, existed: false };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Contorno (modo Stickers): trazar con potrace (Node) — recibe ArrayBuffer del
// PNG B/N y opts, devuelve SVG. Mejores curvas que ImageTracer (que corre en el
// renderer). Mirror del lab printlayout-contour-lab.
ipcMain.handle('contour:trace-potrace', async (_evt, arrayBuffer, opts = {}) => {
  const buffer = Buffer.from(arrayBuffer);
  return new Promise((resolve, reject) => {
    potrace.trace(buffer, {
      threshold: opts.threshold ?? 128,
      turdSize: opts.turdsize ?? 2,
      alphaMax: opts.alphamax ?? 1.0,
      optCurve: true,
      optTolerance: opts.opttolerance ?? 0.2,
      turnPolicy: 'minority',
      blackOnWhite: true,
      background: 'transparent',
      color: '#000000',
    }, (err, svg) => {
      if (err) reject(err);
      else resolve(svg);
    });
  });
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
    fs.mkdirSync(path.dirname(result.filePath), { recursive: true });
    fs.writeFileSync(result.filePath, Buffer.from(bytes));
    return { canceled: false, path: result.filePath };
  } catch (err) {
    return { canceled: false, error: err.message };
  }
});

// Descargar una imagen editada a disco. El renderer manda el dataURL (PNG,
// que es el formato interno de las imagenes ya editadas). Mostramos "Guardar
// como" y escribimos los bytes. Espeja export:save-pdf.
ipcMain.handle('export:save-image', async (evt, { defaultName, dataUrl }) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  const result = await dialog.showSaveDialog(win, {
    title: 'Guardar imagen',
    defaultPath: defaultName ?? 'imagen.png',
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }
  try {
    fs.mkdirSync(path.dirname(result.filePath), { recursive: true });
    fs.writeFileSync(result.filePath, dataUrlToBuffer(dataUrl));
    return { canceled: false, path: result.filePath };
  } catch (err) {
    return { canceled: false, error: err.message };
  }
});

// Reparar PDF (para Corel): el usuario elige uno o varios PDF (típico: hechos en
// Canva que Corel dice "bloqueado"). Ghostscript los re-destila y guarda una
// copia "<nombre>_reparado.pdf" al lado del original, editable en Corel.
ipcMain.handle('pdf:repair', async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!ghostscriptBin()) {
    return { ok: false, error: 'El motor de PDF no está disponible en esta instalación.' };
  }
  const pick = await dialog.showOpenDialog(win, {
    title: 'Elegí el/los PDF a reparar (Canva / “bloqueado” en Corel)',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (pick.canceled || !pick.filePaths?.length) return { canceled: true };
  const results = [];
  for (const inPath of pick.filePaths) {
    try {
      const dir = path.dirname(inPath);
      const base = path.basename(inPath, path.extname(inPath));
      let outPath = path.join(dir, `${base}_reparado.pdf`);
      let n = 2;
      while (fs.existsSync(outPath)) {
        outPath = path.join(dir, `${base}_reparado (${n}).pdf`);
        n++;
      }
      await runGhostscriptRepair(inPath, outPath);
      if (!fs.existsSync(outPath)) throw new Error('no se generó el archivo');
      results.push({ ok: true, name: base, path: outPath });
    } catch (err) {
      results.push({ ok: false, name: path.basename(inPath), error: err.message });
    }
  }
  return { ok: true, results };
});

ipcMain.handle('shell:show-item', (_evt, p) => {
  shell.showItemInFolder(p);
});

// PDF → Imagen: el renderer rasterizo las paginas y nos manda los bytes raw
// (ArrayBuffer/Uint8Array vía structured clone). Aca pedimos carpeta destino y
// guardamos cada archivo. Usar bytes directos en vez de dataURL evita el
// limite practico de canvas.toDataURL a alto DPI (V8 no construye strings
// base64 de cientos de MB).
ipcMain.handle('pdf-to-image:save-batch', async (evt, payload) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  const files = Array.isArray(payload?.files) ? payload.files : [];
  if (files.length === 0) return { canceled: true };

  const pick = await dialog.showOpenDialog(win, {
    title: 'Elegí carpeta donde guardar las imágenes',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (pick.canceled || !pick.filePaths?.[0]) return { canceled: true };

  const outDir = pick.filePaths[0];
  const saved = [];
  const errors = [];
  for (const f of files) {
    try {
      let buf;
      if (f.buffer) {
        // ArrayBuffer/Uint8Array via structured clone -> Buffer sin copia extra.
        buf = Buffer.from(f.buffer);
      } else if (f.dataUrl) {
        buf = dataUrlToBuffer(f.dataUrl);
      } else {
        throw new Error('Sin datos para guardar.');
      }
      const safeName = String(f.name || 'pagina.png').replace(/[\\/:*?"<>|]/g, '_');
      const fullPath = path.join(outDir, safeName);
      fs.writeFileSync(fullPath, buf);
      saved.push(fullPath);
    } catch (err) {
      errors.push({ name: f.name, error: err.message });
    }
  }
  return { canceled: false, dir: outDir, saved, errors };
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
  // El usuario YA aceptó actualizar: marcamos cierre real (app.isQuitting) para
  // que el 'close' de la ventana NO la esconda en la bandeja y el instalador
  // pueda reemplazar la app. El trabajo en curso igual queda auto-guardado.
  app.isQuitting = true;
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

// Entrada automática de pedidos de fotos (Supabase). El servicio vive en
// electron/intake/. La config (con la service key) está SOLO en userData.
ipcMain.handle('intake:get-config', () => intakeService.getConfig());
ipcMain.handle('intake:is-la-recta', () => intakeService.isLaRecta());
ipcMain.handle('intake:set-config', (_evt, patch) => {
  try {
    return { ok: true, config: intakeService.setConfig(patch) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('intake:set-active', (_evt, activo) => {
  try {
    return { ok: true, config: intakeService.setActive(activo) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('intake:choose-dir', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const r = await dialog.showOpenDialog(win, {
      title: 'Carpeta de salida de pedidos',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
    return { ok: true, path: r.filePaths[0] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('intake:test-connection', () => intakeService.testConnection());
ipcMain.handle('intake:poll-now', () => intakeService.pollNow());
ipcMain.handle('intake:read-file', (_evt, localPath) => intakeService.readFile(localPath));
ipcMain.handle('intake:order-built', (_evt, payload) => intakeService.orderBuilt(payload));
ipcMain.handle('intake:dobble-order-built', (_evt, payload) => intakeService.dobbleOrderBuilt(payload));
ipcMain.handle('intake:rotulo-order-built', (_evt, payload) => intakeService.rotuloOrderBuilt(payload));
// Guardado SILENCIOSO del PDF de un pedido de rótulos (sin diálogo): lo deja
// directo en la carpeta configurada, nombrado "PR-<presupuesto> - <nombre>.pdf".
ipcMain.handle('intake:save-rotulo-pdf', (_evt, { dir, numeroPresupuesto, nombre, bytes }) => {
  try {
    if (!dir) return { ok: false, error: 'Falta la carpeta de salida.' };
    const fileName = rotuloPdfFileName(numeroPresupuesto, nombre);
    const filePath = path.join(dir, fileName);
    writePdfSilent(filePath, bytes);
    return { ok: true, path: filePath, fileName };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
// Elegir el PDF ya armado de un mazo de catálogo (mapa mazo_id → PDF).
ipcMain.handle('dobble:choose-pdf', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const r = await dialog.showOpenDialog(win, {
      title: 'Elegí el PDF ya armado del mazo',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePaths?.[0]) return { canceled: true };
    return { ok: true, path: r.filePaths[0] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
// Guardado SILENCIOSO del PDF Dobble (sin diálogo): el exportador automático lo
// deja directo en la carpeta configurada, nombrado "PR-<presupuesto> - <mazo>.pdf".
ipcMain.handle('dobble:save-pdf-silent', (_evt, { dir, numeroPresupuesto, nombreMazo, bytes }) => {
  try {
    if (!dir) return { ok: false, error: 'Falta la carpeta de salida.' };
    const fileName = dobblePdfFileName(numeroPresupuesto, nombreMazo);
    const filePath = path.join(dir, fileName);
    writePdfSilent(filePath, bytes);
    return { ok: true, path: filePath, fileName };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
// PDF listo para imprimir de un pedido de fotos: guardado SILENCIOSO al path
// que arma el renderer (junto al .pljob). Reusa writePdfSilent (crea la carpeta).
ipcMain.handle('intake:save-photo-pdf', (_evt, { filePath, bytes }) => {
  try {
    if (!filePath) return { ok: false, error: 'Falta la ruta del PDF.' };
    writePdfSilent(filePath, bytes);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('intake:publish-catalog', (_evt, rows) => intakeService.publishCatalog(rows));
ipcMain.handle('intake:publish-config', (_evt, { clave, valor }) => intakeService.publishConfig(clave, valor));

// Servidor de corte QR (nuestra File Center). La config vive SOLO en userData.
ipcMain.handle('qrcut:get-config', () => qrCutServer.getConfig());
ipcMain.handle('qrcut:get-status', () => qrCutServer.getStatus());
ipcMain.handle('qrcut:set-config', (_evt, patch) => {
  try {
    const config = qrCutServer.setConfig(patch);
    // Reaplicar la config del portero/relay (activar/desactivar, puerto, allowlist).
    try { qrCutRelay.applyConfig(config); } catch (_) { /* best-effort */ }
    return { ok: true, config };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('qrcut:reconnect', () => {
  try {
    return qrCutServer.reconnectNow();
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
// Botón "Forzar liberar / reconectar": cierra el cliente del relay que esté
// piping y vacía el candado, y reconecta el server QR.
ipcMain.handle('qrcut:force-release', () => {
  try { qrCutRelay.dropActiveClients(); } catch (_) { /* best-effort */ }
  try {
    return qrCutServer.forcePlotterRelease();
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('qrcut:choose-dir', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const r = await dialog.showOpenDialog(win, {
      title: 'Carpeta de cortes (.plt) del corte por QR',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
    return { ok: true, path: r.filePaths[0] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(() => {
  // Si no obtuvimos el lock de instancia única, esta copia ya llamó app.quit():
  // no armamos nada (la primera instancia es la que corre).
  if (!gotSingleInstanceLock) return;
  createWindow();   // arranca OCULTA (show:false)
  createTray();     // ícono en la bandeja
  setupAutoUpdate(mainWindow);
  intakeService.start(mainWindow);
  qrCutServer.start(mainWindow);
  qrCutRelay.start();   // portero: escucha en 0.0.0.0:relayPort si relayActivo

  app.on('activate', () => {
    // macOS (dock): si no hay ventana, la creamos; si está oculta, la mostramos.
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    showMainWindow();
  });
});

app.on('window-all-closed', () => {
  // NO cerramos: la app sigue viva en la bandeja aunque no haya ventana visible.
  // El cierre real pasa por quitApp() / el updater (app.isQuitting + app.quit()).
});
