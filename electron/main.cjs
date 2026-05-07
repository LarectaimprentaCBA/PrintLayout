const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { autoUpdater } = require('electron-updater');
const templatesStore = require('./templates-store.cjs');

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

// printWin persistente: lo reutilizamos entre impresiones para que
// Chromium retenga las preferencias del dialogo (impresora, papel, etc.).
let printWin = null;
const printTmpDirs = new Set();

function ensurePrintWindow(parentWin) {
  if (printWin && !printWin.isDestroyed()) return printWin;
  printWin = new BrowserWindow({
    show: false,
    parent: parentWin ?? undefined,
    webPreferences: {
      sandbox: false,
    },
  });
  printWin.on('closed', () => {
    printWin = null;
    // Borrar todos los tmp dirs que hayan quedado.
    for (const d of printTmpDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
    }
    printTmpDirs.clear();
  });
  return printWin;
}

ipcMain.handle('print:pdf', async (evt, payload) => {
  const { images, pageWidthMm, pageHeightMm } = payload ?? {};
  if (!Array.isArray(images) || images.length === 0) {
    return { ok: false, error: 'No hay paginas para imprimir.' };
  }
  if (!pageWidthMm || !pageHeightMm) {
    return { ok: false, error: 'Tamano de hoja no definido.' };
  }
  const parentWin = BrowserWindow.fromWebContents(evt.sender);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printlayout-print-'));
  printTmpDirs.add(tmpDir);
  const tmpHtml = path.join(tmpDir, 'print.html');

  // HTML con @page del tamano exacto. Imprimir HTML evita el bug del visor
  // PDF de Chromium en builds packaged (sale hoja en blanco).
  const pages = images
    .map((src) => `<div class="page"><img src="${src}"/></div>`)
    .join('');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  @page { size: ${pageWidthMm}mm ${pageHeightMm}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .page { width: ${pageWidthMm}mm; height: ${pageHeightMm}mm; page-break-after: always; overflow: hidden; }
  .page:last-child { page-break-after: auto; }
  .page img { width: 100%; height: 100%; display: block; }
</style></head>
<body>${pages}</body></html>`;

  try {
    fs.writeFileSync(tmpHtml, html, 'utf-8');
  } catch (err) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    printTmpDirs.delete(tmpDir);
    return { ok: false, error: `No se pudo crear el HTML temporal: ${err.message}` };
  }

  const win = ensurePrintWindow(parentWin);

  return await new Promise((resolve) => {
    let resolved = false;
    const settle = (result) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    // Liberar UI a los 5s; la window queda viva con el dialogo, asi el
    // usuario puede tocar Propiedades sin que se cierre.
    setTimeout(() => settle({ ok: true, async: true }), 5000);

    const cleanupTmp = () => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      printTmpDirs.delete(tmpDir);
    };

    const onLoaded = () => {
      // Esperar que las <img> dataURL terminen de decodificarse antes
      // de imprimir. Sin esto algunas impresoras reciben el job antes
      // de que Chromium pinte y sale hoja en blanco.
      win.webContents
        .executeJavaScript(
          `Promise.all(Array.from(document.images).map((img) =>
             img.complete ? Promise.resolve() :
             new Promise((r) => { img.onload = img.onerror = r; })
           )).then(() => true)`,
          true,
        )
        .catch(() => null)
        .finally(() => {
          if (win.isDestroyed()) return;
          win.webContents.print(
            {
              silent: false,
              printBackground: true,
              margins: { marginType: 'none' },
              pageSize: {
                width: Math.round(pageWidthMm * 1000),
                height: Math.round(pageHeightMm * 1000),
              },
            },
            (success, reason) => {
              cleanupTmp();
              if (success) settle({ ok: true });
              else if (reason === 'cancelled') settle({ ok: false, canceled: true });
              else settle({ ok: false, error: reason || 'Impresion fallida.' });
            },
          );
        });
    };

    const onFailed = (_e, code, desc) => {
      cleanupTmp();
      settle({ ok: false, error: `No se pudo cargar el HTML (${code}): ${desc}` });
    };

    win.webContents.once('did-finish-load', onLoaded);
    win.webContents.once('did-fail-load', onFailed);

    win.loadFile(tmpHtml).catch((err) => {
      cleanupTmp();
      settle({ ok: false, error: err.message });
    });
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
