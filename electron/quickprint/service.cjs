// "Imprimir con PrintLayout" desde el clic derecho de Windows (fotos + PDF).
//
// Abre una ventana chica APARTE (no toca la ventana principal ni sus pestañas)
// que imprime por el camino de PrintLayout → así la corrección de color de la
// Ricoh calibrada se aplica sola. Fotos: como "Imprimir imágenes" de Windows.
// PDF: rasterizado con el Ghostscript embebido (no pdf.js — ignora ICC, no
// dibuja algunos degradés y revienta con PDF gigantes).
//
// El main llama a init({deps}) una vez (con las funciones que viven en main.cjs)
// y luego enqueue(files) cada vez que llegan archivos por --imprimir.
'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const printCore = require('../print-core.cjs');
const qrcutConfig = require('../qrcut/config-store.cjs');

const PHOTO_EXTS = ['.jpg', '.jpeg', '.png', '.heic', '.heif'];

let deps = null;         // { resolvePrintHelper, devmodeFilePath, ghostscriptBin, GHOSTSCRIPT_DIR, appendDebugLog, isDev }
let win = null;          // BrowserWindow de la ventana de impresión
let coalesceBuffer = []; // archivos acumulados mientras Explorer los va soltando
let coalesceTimer = null;
let deliveredPayload = null; // { photos, pdfs, unsupported } listo para el renderer
const allowedPaths = new Set(); // rutas que el renderer puede leer (seguridad)

// ── argv ────────────────────────────────────────────────────────────────────
// Extrae las rutas de archivos existentes que siguen a `--imprimir`. Si no está
// el flag, devuelve []. Acepta rutas sueltas (Explorer con MultiSelectModel=Player
// las pasa todas en una sola invocación) o una por invocación (coalescemos).
function filesFromArgv(argv) {
  const out = [];
  const arr = Array.isArray(argv) ? argv : [];
  const idx = arr.indexOf('--imprimir');
  if (idx < 0) return out;
  for (let i = idx + 1; i < arr.length; i++) {
    const a = arr[i];
    if (typeof a !== 'string' || a.startsWith('--')) continue;
    try { if (fs.existsSync(a)) out.push(a); } catch (_) { /* ruta rara */ }
  }
  return out;
}

function classify(files) {
  const photos = [], pdfs = [], unsupported = [];
  const seen = new Set();
  for (const f of files) {
    if (seen.has(f)) continue;
    seen.add(f);
    const ext = path.extname(f).toLowerCase();
    const item = { path: f, name: path.basename(f) };
    if (PHOTO_EXTS.includes(ext)) photos.push(item);
    else if (ext === '.pdf') pdfs.push(item);
    else unsupported.push(item);
  }
  return { photos, pdfs, unsupported };
}

// ── ventana ───────────────────────────────────────────────────────────────
function boundsFile() {
  return path.join(app.getPath('userData'), 'quickprint-window.json');
}
function loadBounds() {
  try { return JSON.parse(fs.readFileSync(boundsFile(), 'utf-8')); } catch (_) { return null; }
}
function saveBounds() {
  try {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    fs.writeFileSync(boundsFile(), JSON.stringify(b), 'utf-8');
  } catch (_) { /* best-effort */ }
}

function createWindow() {
  const saved = loadBounds();
  win = new BrowserWindow({
    width: saved?.width || 760,
    height: saved?.height || 820,
    x: saved?.x, y: saved?.y,
    minWidth: 560,
    minHeight: 620,
    backgroundColor: '#0b0d10',
    title: 'Imprimir con PrintLayout',
    icon: deps.appIconImage ? deps.appIconImage() : undefined,
    show: false,
    // Ventana INDEPENDIENTE: sin parent, así no arrastra ni bloquea la principal.
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);

  if (deps.isDev) {
    win.loadURL('http://localhost:5174/quickprint.html');
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'quickprint.html'));
  }

  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.on('close', saveBounds);
  win.on('closed', () => { win = null; });
}

// Abre la ventana (o la actualiza si ya está abierta) con la selección coalescida.
function flushCoalesce() {
  coalesceTimer = null;
  const files = coalesceBuffer.slice();
  coalesceBuffer = [];
  if (files.length === 0) return;
  for (const f of files) allowedPaths.add(f);

  const payload = classify(files);
  if (!win || win.isDestroyed()) {
    deliveredPayload = payload;
    createWindow();
  } else {
    // Ya hay una ventana: le sumamos los archivos y la traemos al frente.
    deliveredPayload = payload; // por si el renderer aún no pidió get-files
    try {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('quickprint:files-added', payload);
    } catch (_) { /* noop */ }
  }
}

function enqueue(files) {
  if (!Array.isArray(files) || files.length === 0) return;
  coalesceBuffer.push(...files);
  // Explorer puede invocar el verbo una vez por archivo (según el modelo de
  // selección). Esperamos una ventanita para juntar TODA la selección en una
  // sola ventana. 350 ms alcanza y no se nota.
  if (coalesceTimer) clearTimeout(coalesceTimer);
  coalesceTimer = setTimeout(flushCoalesce, 250);
}

// ── PrintHelper: pageinfo ────────────────────────────────────────────────────
function getPageInfo(deviceName) {
  return new Promise((resolve) => {
    const helperExe = deps.resolvePrintHelper();
    if (!helperExe) return resolve({ ok: false, error: 'No se encontró PrintHelper.exe.' });
    if (!deviceName) return resolve({ ok: false, error: 'Falta la impresora.' });
    const dm = deps.devmodeFilePath(deviceName);
    const lines = ['MODE=pageinfo', `DEVICE=${deviceName}`];
    if (dm && fs.existsSync(dm)) lines.push(`DEVMODE_FILE=${dm}`);
    lines.push('END=1');
    let out = '', err = '';
    let proc;
    try { proc = spawn(helperExe, [], { windowsHide: true }); }
    catch (e) { return resolve({ ok: false, error: e.message }); }
    proc.stdout.on('data', (d) => { out += d.toString('utf-8'); });
    proc.stderr.on('data', (d) => { err += d.toString('utf-8'); });
    proc.on('error', (e) => resolve({ ok: false, error: e.message }));
    proc.on('close', () => {
      const r = {};
      for (const ln of out.split(/\r?\n/)) { const eq = ln.indexOf('='); if (eq > 0) r[ln.slice(0, eq)] = ln.slice(eq + 1); }
      if (r.OK !== '1') return resolve({ ok: false, error: r.ERROR || 'no se pudo leer la impresora' });
      resolve({
        ok: true,
        paperWmm: +r.PAPER_W_MM, paperHmm: +r.PAPER_H_MM,
        printWmm: +r.PRINT_W_MM, printHmm: +r.PRINT_H_MM,
        marginLmm: +r.MARGIN_L_MM, marginTmm: +r.MARGIN_T_MM,
        orientation: r.ORIENTATION || 'portrait',
        duplex: r.DUPLEX === '1',
      });
    });
    try { proc.stdin.write(lines.join('\n') + '\n', 'utf-8'); proc.stdin.end(); }
    catch (e) { resolve({ ok: false, error: e.message }); }
  });
}

// ── Ghostscript: PDF → PNG ──────────────────────────────────────────────────
function gsIncludeArgs() {
  const G = deps.GHOSTSCRIPT_DIR;
  return [
    `-I${path.join(G, 'lib')}`,
    `-I${path.join(G, 'Resource', 'Init')}`,
    `-I${path.join(G, 'Resource')}`,
    `-I${path.join(G, 'iccprofiles')}`,
  ];
}

// Cuenta las páginas de un PDF con Ghostscript (streaming, sin cargar el archivo
// entero en RAM → sirve para el PDF de 2,7 GB). Devuelve 0 si falla.
function getPdfPageCount(inPath) {
  return new Promise((resolve) => {
    const gs = deps.ghostscriptBin();
    if (!gs) return resolve(0);
    // En un string PostScript hay que usar / y escapar ( ) \ (nombres con
    // paréntesis como "Mazo (3 hojas).pdf" romperían el string).
    const psPath = inPath.replace(/\\/g, '/').replace(/[()\\]/g, (m) => '\\' + m);
    const args = ['-q', '-dNODISPLAY', '-dNOSAFER', '-dBATCH', '-dNOPAUSE', '-c',
      `(${psPath}) (r) file runpdfbegin pdfpagecount = quit`];
    let out = '';
    let proc;
    try { proc = spawn(gs, args, { windowsHide: true }); }
    catch (_) { return resolve(0); }
    proc.stdout.on('data', (d) => { out += d.toString('utf-8'); });
    proc.on('error', () => resolve(0));
    proc.on('close', () => { const m = out.match(/\d+/); resolve(m ? parseInt(m[0], 10) : 0); });
  });
}

// Rasteriza un rango CONTIGUO [first,last] en un solo proceso GS. Prefijo por
// rango para no chocar cuando corren varios en paralelo en el mismo dir.
function rasterizeRange(inPath, outDir, dpi, first, last) {
  return new Promise((resolve) => {
    const gs = deps.ghostscriptBin();
    if (!gs) return resolve({ ok: false, error: 'Ghostscript no disponible.', pages: [] });
    const prefix = `r${first}_`;
    const cmyk = path.join(deps.GHOSTSCRIPT_DIR, 'iccprofiles', 'default_cmyk.icc');
    const args = [
      ...gsIncludeArgs(),
      '-sDEVICE=png16m', `-r${dpi}`,
      '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
      '-dNOPAUSE', '-dBATCH', '-dQUIET',
      `-dFirstPage=${first}`, `-dLastPage=${last}`,
    ];
    if (fs.existsSync(cmyk)) args.push(`-sDefaultCMYKProfile=${cmyk}`);
    args.push(`-sOutputFile=${path.join(outDir, prefix + '%04d.png')}`, inPath);
    let err = '';
    let proc;
    try { proc = spawn(gs, args, { windowsHide: true }); }
    catch (e) { return resolve({ ok: false, error: e.message, pages: [] }); }
    proc.stderr.on('data', (d) => { err += d.toString('utf-8'); });
    proc.on('error', (e) => resolve({ ok: false, error: e.message, pages: [] }));
    proc.on('close', (code) => {
      if (code !== 0) return resolve({ ok: false, error: `Ghostscript salió con código ${code}: ${err.slice(0, 300)}`, pages: [] });
      const pages = [];
      for (let n = first; n <= last; n++) {
        const p = path.join(outDir, prefix + String(n - first + 1).padStart(4, '0') + '.png');
        if (fs.existsSync(p)) pages.push({ pageIndex: n, path: p });
      }
      resolve({ ok: true, pages });
    });
  });
}

// Rasteriza [first,last] en paralelo (núcleos-1, máx 6). Todo o nada: si un
// chunk falla, devuelve error (no imprimir páginas de menos en silencio).
async function rasterizePages(inPath, outDir, dpi, first, last) {
  const total = last - first + 1;
  const N = Math.min(Math.max((os.cpus().length || 2) - 1, 1), 6);
  const chunkSize = Math.ceil(total / N);
  const tasks = [];
  for (let s = first; s <= last; s += chunkSize) {
    tasks.push(rasterizeRange(inPath, outDir, dpi, s, Math.min(s + chunkSize - 1, last)));
  }
  const results = await Promise.all(tasks);
  const bad = results.find((r) => !r.ok);
  if (bad) return { ok: false, error: bad.error, pages: [] };
  const pages = [];
  for (const r of results) pages.push(...r.pages);
  pages.sort((a, b) => a.pageIndex - b.pageIndex);
  if (!pages.length) return { ok: false, error: 'No se rasterizó ninguna página.', pages: [] };
  return { ok: true, pages };
}

// Lee ancho/alto en px de un PNG (IHDR).
function pngSizePx(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } finally { fs.closeSync(fd); }
}

function getPrintScale() {
  try {
    const pct = Number(qrcutConfig.load().printScalePct);
    return (Number.isFinite(pct) && pct >= 90 && pct <= 110) ? pct / 100 : 1;
  } catch (_) { return 1; }
}

// ── impresión ────────────────────────────────────────────────────────────────
// Prefija el nombre de máquina (config Corte QR) al nombre del trabajo, para que
// en la cola de la impresora se vea de qué PC salió (igual que la ventana grande).
function withMachine(docName) {
  try {
    const m = (qrcutConfig.load().machineName || '').trim();
    return m ? `${m} - ${docName}` : docName;
  } catch (_) { return docName; }
}

// Impresión de fotos por STREAMING: el renderer manda cada hoja (PNG) apenas la
// arma; acá se escribe a un dir temporal. Así la memoria queda plana (una hoja a
// la vez) y no viaja un mensaje IPC gigante. Al final, un solo trabajo de impresión.
const photoSessions = new Map(); // id -> { dir, paths[] }
let photoSessionSeq = 0;

function photosBegin() {
  const id = `ps${Date.now().toString(36)}_${photoSessionSeq++}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printlayout-photos-'));
  photoSessions.set(id, { dir, paths: [] });
  return { ok: true, id };
}
function photosAdd(id, buffer) {
  const s = photoSessions.get(id);
  if (!s) return { ok: false, error: 'sesión inválida' };
  const p = path.join(s.dir, `sheet-${String(s.paths.length).padStart(3, '0')}.png`);
  fs.writeFileSync(p, Buffer.from(buffer));
  s.paths.push(p);
  return { ok: true };
}
async function photosPrint(id, { pageWidthMm, pageHeightMm, deviceName, copies, docName }) {
  const s = photoSessions.get(id);
  if (!s || !s.paths.length) return { ok: false, error: 'no hay hojas para imprimir' };
  const scale = getPrintScale();
  try {
    return await printCore.runPrintJob({
      pages: s.paths.map((p) => ({ path: p })),
      pageWidthMm: pageWidthMm * scale,
      pageHeightMm: pageHeightMm * scale,
      deviceName, copies, showDialog: false, docName: withMachine(docName),
      helperExe: deps.resolvePrintHelper(),
      savedDevmodePath: deviceName ? deps.devmodeFilePath(deviceName) : null,
      appendDebugLog: deps.appendDebugLog,
    });
  } finally {
    try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch {}
    photoSessions.delete(id);
  }
}
function photosCancel(id) {
  const s = photoSessions.get(id);
  if (s) { try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch {} photoSessions.delete(id); }
  return { ok: true };
}

// sizeMode: 'fit' | 'actual' | 'fitlarge' | 'custom'. orientation: 'auto'|'vertical'|'horizontal'.
async function printPdf({ path: pdfPath, pages, dpi, sizeMode, scalePct, orientation, deviceName, copies, docName }) {
  if (!pdfPath || !allowedPaths.has(pdfPath)) return { ok: false, error: 'Archivo no permitido.' };
  const info = await getPageInfo(deviceName);
  if (!info.ok) return info;
  const count = await getPdfPageCount(pdfPath);
  let wanted = (Array.isArray(pages) && pages.length)
    ? pages.filter((p) => p >= 1 && (!count || p <= count))
    : (count ? Array.from({ length: count }, (_, i) => i + 1) : null);
  if (!wanted || !wanted.length) return { ok: false, error: 'No se pudo determinar las páginas del PDF.' };

  const first = Math.min(...wanted), last = Math.max(...wanted);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printlayout-gs-'));
  try {
    const rr = await rasterizePages(pdfPath, outDir, dpi || 240, first, last);
    if (!rr.ok) return { ok: false, error: `No se pudo procesar el PDF: ${rr.error}` };
    const byPage = new Map(rr.pages.map((r) => [r.pageIndex, r]));
    const scale = getPrintScale();
    const { printWmm, printHmm } = info;
    const sheetLandscape = printWmm > printHmm;

    const jobPages = [];
    for (const pnum of wanted) {
      const r = byPage.get(pnum);
      if (!r) continue;
      const dim = pngSizePx(r.path);
      const d = dpi || 240;
      const nativeWmm = dim.w / d * 25.4;
      const nativeHmm = dim.h / d * 25.4;
      const pageLandscape = nativeWmm > nativeHmm;
      let rot = 0;
      if (orientation === 'vertical' && pageLandscape) rot = 90;
      else if (orientation === 'horizontal' && !pageLandscape) rot = 90;
      else if ((orientation || 'auto') === 'auto' && pageLandscape !== sheetLandscape) rot = 90;
      let ewMm = nativeWmm, ehMm = nativeHmm;
      if (rot === 90 || rot === 270) { ewMm = nativeHmm; ehMm = nativeWmm; }

      let twMm, thMm;
      if (sizeMode === 'actual') { twMm = ewMm; thMm = ehMm; }
      else if (sizeMode === 'custom') { const s = (Number(scalePct) || 100) / 100; twMm = ewMm * s; thMm = ehMm * s; }
      else if (sizeMode === 'fitlarge') { const f = Math.min(printWmm / ewMm, printHmm / ehMm, 1); twMm = ewMm * f; thMm = ehMm * f; }
      else { const f = Math.min(printWmm / ewMm, printHmm / ehMm); twMm = ewMm * f; thMm = ehMm * f; } // 'fit'

      jobPages.push({ path: r.path, wMm: twMm * scale, hMm: thMm * scale, rot });
    }
    if (!jobPages.length) return { ok: false, error: 'No se pudo preparar ninguna página.' };

    // WIDTH_MM/HEIGHT_MM global = fallback; cada página lleva su PAGE_MM real.
    // OJO: `return await` es OBLIGATORIO — sin await, el finally borraría la
    // carpeta de PNG ANTES de que la impresión los lea (ENOENT).
    return await printCore.runPrintJob({
      pages: jobPages,
      pageWidthMm: info.paperWmm, pageHeightMm: info.paperHmm,
      deviceName, copies, showDialog: false, docName: withMachine(docName),
      helperExe: deps.resolvePrintHelper(),
      savedDevmodePath: deviceName ? deps.devmodeFilePath(deviceName) : null,
      appendDebugLog: deps.appendDebugLog,
    });
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
}

// Renderiza UNA página del PDF a dataURL (preview, baja resolución). Cachea el
// renderer; acá solo hacemos una página por llamada.
async function renderPdfPage(pdfPath, pageIndex, dpi) {
  if (!pdfPath || !allowedPaths.has(pdfPath)) return { ok: false, error: 'Archivo no permitido.' };
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printlayout-gsprev-'));
  try {
    const rr = await rasterizeRange(pdfPath, outDir, dpi || 96, pageIndex, pageIndex);
    if (!rr.ok || !rr.pages.length) return { ok: false, error: rr.error || 'no se pudo renderizar la página' };
    const p = rr.pages[0].path;
    const dim = pngSizePx(p);
    const d = dpi || 96;
    const buf = fs.readFileSync(p);
    return {
      ok: true,
      dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
      wMm: dim.w / d * 25.4, hMm: dim.h / d * 25.4,
    };
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────
function registerIpc() {
  ipcMain.handle('quickprint:get-files', () => {
    const p = deliveredPayload || { photos: [], pdfs: [], unsupported: [] };
    return p;
  });
  ipcMain.handle('quickprint:read-file', (_evt, filePath) => {
    try {
      if (!filePath || !allowedPaths.has(filePath)) return { ok: false, error: 'archivo no permitido' };
      return { ok: true, bytes: fs.readFileSync(filePath) };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('quickprint:page-info', (_evt, { deviceName }) => getPageInfo(deviceName));
  ipcMain.handle('quickprint:pdf-info', async (_evt, { path: pdfPath }) => {
    if (!pdfPath || !allowedPaths.has(pdfPath)) return { ok: false, error: 'archivo no permitido' };
    const count = await getPdfPageCount(pdfPath);
    return { ok: true, pageCount: count };
  });
  ipcMain.handle('quickprint:render-pdf-page', (_evt, { path: pdfPath, pageIndex, dpi }) =>
    renderPdfPage(pdfPath, pageIndex, dpi));
  ipcMain.handle('quickprint:photos-begin', () => photosBegin());
  ipcMain.handle('quickprint:photos-add', (_evt, { id, buffer }) => photosAdd(id, buffer));
  ipcMain.handle('quickprint:photos-print', (_evt, { id, ...opts }) => photosPrint(id, opts));
  ipcMain.handle('quickprint:photos-cancel', (_evt, { id }) => photosCancel(id));
  ipcMain.handle('quickprint:print-pdf', (_evt, payload) => printPdf(payload));
  ipcMain.handle('quickprint:close', () => { try { if (win && !win.isDestroyed()) win.close(); } catch (_) {} });
}

function init(d) {
  deps = d;
  registerIpc();
}

module.exports = { init, filesFromArgv, enqueue };
