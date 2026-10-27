// Núcleo de impresión REUSABLE (lo comparten print:pdf de la ventana principal y
// la ventana "Imprimir con PrintLayout" del clic derecho). Aplica la corrección
// de color por IP (best-effort, nunca corrige en silencio sin avisar) y manda las
// hojas al PrintHelper.exe. Soporta tamaño y rotación POR hoja (PDF de tamaños
// mixtos + orientación automática).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const colorStore = require('./color/store.cjs');
const colorPrinters = require('./color/printers.cjs');
const { ColorApplier } = require('./color/apply.cjs');

// Decodifica una dataURL `data:image/png;base64,xxx` a Buffer.
function dataUrlToBuffer(dataUrl) {
  const m = /^data:[^;]+;base64,(.+)$/.exec(dataUrl ?? '');
  if (!m) throw new Error('dataURL invalida (se esperaba base64).');
  return Buffer.from(m[1], 'base64');
}

// Resuelve el aplicador de corrección para una impresora.
// Mismo criterio que tenía print:pdf: solo en impresión silent (showDialog===false),
// sin noColorCorrection, y si esa impresora tiene una calibración ACTIVA en esta PC.
//
// Orden de resolución: PRIMERO la asignación manual por nombre de COLA (y ahí ni
// siquiera miramos la IP: el nombre de cola no cambia, la IP sí), y si la cola no
// está asignada, la IP como siempre.
// Rendimiento: 0 ms si no hay ninguna activa; caché cola→IP si la hay.
async function resolveColorApplier({ deviceName, showDialog, noColorCorrection }) {
  let applier = null, colorCal = null, colorIp = null, colorVia = '-';
  let colorStatus = { state: 'no-active' };
  const t0 = Date.now();
  try {
    if (showDialog === false && !noColorCorrection && deviceName && colorStore.hasAnyActive()) {
      let cal = null;
      let timedOut = false;
      const manualRec = colorStore.getManualPrinter()[deviceName];
      if (manualRec) {
        colorVia = 'cola';
        colorIp = manualRec.ip || null;
        cal = colorStore.getActiveForQueue(deviceName);
      } else {
        colorVia = 'ip';
        const manual = colorStore.getManualIp();
        let ip = colorPrinters.resolveFromCache(deviceName, manual); // ~0 ms
        if (!ip) {
          const r = await colorPrinters.resolveOneQueue(deviceName, manual, 900);
          ip = r.ip;
          timedOut = r.timedOut;
        }
        colorIp = ip;
        cal = ip ? colorStore.getActiveForIp(ip, deviceName) : null;
      }
      if (cal) {
        const S = cal.lutSize || 17;
        const expected = S * S * S * 3;
        if (Array.isArray(cal.lut) && cal.lut.length === expected) {
          applier = new ColorApplier({ V: cal.lut, S });
          colorCal = cal;
        } else {
          colorStatus = { state: 'fallo', reason: 'la tabla de la calibración es inválida' };
        }
      } else if (timedOut) {
        colorStatus = { state: 'fallo', reason: 'no se pudo identificar la impresora (IP) a tiempo' };
      } else {
        colorStatus = { state: 'no-corresponde' };
      }
    } else if (showDialog !== false || noColorCorrection) {
      colorStatus = { state: 'no-corresponde' };
    }
  } catch (err) {
    colorStatus = { state: 'fallo', reason: err.message || 'error al resolver la calibración' };
  }
  return { applier, colorCal, colorIp, colorVia, colorStatus, colorResolveMs: Date.now() - t0 };
}

// Imprime un conjunto de hojas.
//   pages: array de items { dataUrl } | { buffer } | { path }  (uno de los tres)
//          + opcionales { wMm, hMm, rot } (tamaño/rotación de ESA hoja).
//   helperExe: ruta a PrintHelper.exe.
//   savedDevmodePath: ruta al DEVMODE guardado de la impresora (o null).
//   devmodeB64: DEVMODE de sesión (prioridad sobre el guardado; no lo pisa).
// Los `path` de entrada NO se borran (los limpia el llamador); sí se borra el tmp
// propio. Devuelve { ok, color, error?, canceled? }.
async function runPrintJob({
  pages, pageWidthMm, pageHeightMm, deviceName, copies, showDialog, docName,
  devmodeB64, noColorCorrection, helperExe, savedDevmodePath, appendDebugLog,
}) {
  const log = typeof appendDebugLog === 'function' ? appendDebugLog : () => {};
  if (!Array.isArray(pages) || pages.length === 0) return { ok: false, error: 'No hay paginas para imprimir.' };
  if (!pageWidthMm || !pageHeightMm) return { ok: false, error: 'Tamano de hoja no definido.' };
  if (!helperExe) return { ok: false, error: 'Falta un archivo de PrintLayout (PrintHelper.exe), que es el que manda las hojas a la impresora. Casi siempre lo borra el antivirus: agregá una exclusión para la carpeta de PrintLayout y volvé a instalarlo.' };

  let { applier, colorCal, colorIp, colorVia, colorStatus, colorResolveMs } =
    await resolveColorApplier({ deviceName, showDialog, noColorCorrection });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printlayout-print-'));
  const pagePaths = [];
  const pageMeta = [];
  const msPerPage = [];

  const toBuf = (pg) => {
    if (pg.buffer) return Buffer.isBuffer(pg.buffer) ? pg.buffer : Buffer.from(pg.buffer);
    if (pg.dataUrl) return dataUrlToBuffer(pg.dataUrl);
    if (pg.path) return fs.readFileSync(pg.path);
    throw new Error('página sin datos');
  };

  // Hoja de origen ya corregida → su archivo corregido. Hace falta para imprimir
  // sin intercalar: ahí la MISMA hoja se repite N veces y corregirla 99 veces
  // tardaría minutos en vez de un segundo.
  const corregidas = new Map();

  try {
    for (let i = 0; i < pages.length; i++) {
      const pg = pages[i];
      pageMeta.push({ wMm: Number(pg.wMm) || 0, hMm: Number(pg.hMm) || 0, rot: Number(pg.rot) || 0 });
      if (applier) {
        const yaHecha = pg.path ? corregidas.get(pg.path) : null;
        if (yaHecha) { pagePaths.push(yaHecha); msPerPage.push(0); continue; }
        const r = await applier.applyPng(toBuf(pg));
        const outP = path.join(tmpDir, `page-${String(i).padStart(3, '0')}.png`);
        fs.writeFileSync(outP, r.buffer);
        if (pg.path) corregidas.set(pg.path, outP);
        pagePaths.push(outP);
        msPerPage.push(r.ms);
        if (!r.ok && colorStatus.state !== 'fallo') colorStatus = { state: 'fallo', reason: r.reason, page: i + 1 };
      } else if (pg.path) {
        // Sin corrección y ya está en disco (rasterizado por GS): pasarlo directo.
        pagePaths.push(pg.path);
      } else {
        const outP = path.join(tmpDir, `page-${String(i).padStart(3, '0')}.png`);
        fs.writeFileSync(outP, toBuf(pg));
        pagePaths.push(outP);
      }
    }
  } catch (err) {
    if (applier) applier.dispose();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return { ok: false, error: `No se pudieron preparar las hojas: ${err.message}` };
  }
  if (applier) applier.dispose();
  if (applier && colorStatus.state !== 'fallo') colorStatus = { state: 'aplicada' };

  if (colorStatus.state === 'aplicada') {
    log(`[color] OK impresora="${deviceName}" via=${colorVia} ip=${colorIp} cal=${colorCal && colorCal.id} hojas=${pages.length} resolveMs=${colorResolveMs} msPorHoja=[${msPerPage.join(',')}]`);
  } else if (colorStatus.state === 'fallo') {
    log(`[color] FALLO impresora="${deviceName}" via=${colorVia} ip=${colorIp} cal=${colorCal && colorCal.id} motivo="${colorStatus.reason}"${colorStatus.page ? ' hoja=' + colorStatus.page : ''}`);
  }

  const lines = ['MODE=print'];
  if (deviceName) lines.push(`DEVICE=${deviceName}`);
  if (typeof copies === 'number' && copies > 0) lines.push(`COPIES=${Math.floor(copies)}`);
  lines.push(`SHOW_DIALOG=${showDialog === false ? '0' : '1'}`);
  lines.push(`WIDTH_MM=${pageWidthMm}`);
  lines.push(`HEIGHT_MM=${pageHeightMm}`);
  if (typeof docName === 'string' && docName.trim()) {
    lines.push(`DOC_NAME=${docName.replace(/[\r\n]+/g, ' ').trim().slice(0, 120)}`);
  }
  // DEVMODE de sesión (prioridad) o el guardado de la impresora.
  if (typeof devmodeB64 === 'string' && devmodeB64) {
    try {
      const dmSession = path.join(tmpDir, 'devmode-sesion.bin');
      fs.writeFileSync(dmSession, Buffer.from(devmodeB64, 'base64'));
      lines.push(`DEVMODE_FILE=${dmSession}`);
    } catch (err) { /* seguimos con el default del driver */ }
  } else if (savedDevmodePath && fs.existsSync(savedDevmodePath)) {
    lines.push(`DEVMODE_FILE=${savedDevmodePath}`);
  }
  // Hojas con tamaño/rotación por hoja (PDF mixto / orientación auto).
  for (let i = 0; i < pagePaths.length; i++) {
    const m = pageMeta[i];
    if (m && m.wMm > 0 && m.hMm > 0) lines.push(`PAGE_MM=${m.wMm},${m.hMm}`);
    if (m && m.rot) lines.push(`PAGE_ROT=${m.rot}`);
    lines.push(`PAGE=${pagePaths[i]}`);
  }
  lines.push('END=1');

  return await new Promise((resolve) => {
    let stdout = '', stderr = '', settled = false;
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
    proc.on('error', (err) => settle({ ok: false, error: `PrintHelper fallo: ${err.message}` }));
    proc.on('close', (code) => {
      const result = {};
      for (const ln of stdout.split(/\r?\n/)) {
        const eq = ln.indexOf('=');
        if (eq <= 0) continue;
        result[ln.slice(0, eq)] = ln.slice(eq + 1);
      }
      if (result.OK === '1') settle({ ok: true, color: colorStatus });
      else if (result.CANCELED === '1' || code === 2) settle({ ok: false, canceled: true });
      else settle({ ok: false, error: result.ERROR || stderr.trim() || `PrintHelper exit ${code}` });
    });
    try {
      proc.stdin.write(lines.join('\n') + '\n', 'utf-8');
      proc.stdin.end();
    } catch (err) {
      settle({ ok: false, error: `No se pudo enviar input al helper: ${err.message}` });
    }
  });
}

module.exports = { runPrintJob, resolveColorApplier, dataUrlToBuffer };
