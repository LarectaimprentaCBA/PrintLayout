// Config del "Servidor de corte QR" (nuestra File Center, reemplazo de
// QRFileCut.exe). Vive SOLO en userData/qrcut-config.json (no en el repo/bundle),
// así persiste entre reinicios y no se pierde como pasaba con el programa chino.
//
// Forma: { plotterIP, plotterPort, cortesDir, activo }.
//
// plotterIP/plotterPort son la ÚNICA fuente de verdad de la IP del plotter: la
// usa tanto este servidor como el envío directo de cortes (send_to_plotter.py),
// así hay un solo lugar para cambiarla si cambia la red del taller.

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FILENAME = 'qrcut-config.json';
const DEFAULTS = {
  plotterIP: '192.168.100.250',
  plotterPort: 8080,
  // Carpeta donde el operario deja los .plt (el QR trae el nombre del archivo).
  // Acepta ruta de red UNC (\\SERVIDOR\Cortes) para el escenario multi-PC.
  cortesDir: 'C:\\Users\\4\\Desktop\\Clientes\\Cortes QR',
  // Arranca solo al abrir PrintLayout (esta PC es el servidor). En una PC que NO
  // esté conectada al plotter, destildar para que no intente conectarse.
  activo: true,
  // --- Dibujo del QR en la hoja (para el corte por QR) ---
  // Valores que usa Corel (verificados): QR de 8mm, centro a 9,5mm del borde
  // inferior, centrado horizontal. Se ajustan si la cámara del cabezal no lee.
  qrSizeMm: 8,
  qrBottomMm: 9.5,
  qrCentered: true,
  // Prefijo opcional para el nombre del corte (por PC/turno). Vacío = solo el
  // timestamp. Se sanea igual que el nombre (QR/filesystem-safe).
  cutPrefix: '',
};

function getFilePath() {
  return path.join(app.getPath('userData'), FILENAME);
}

function sanitize(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  let port = Number(c.plotterPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) port = DEFAULTS.plotterPort;
  const ip = typeof c.plotterIP === 'string' && c.plotterIP.trim()
    ? c.plotterIP.trim()
    : DEFAULTS.plotterIP;
  const num = (v, def, min, max) => {
    let n = Number(v);
    if (!Number.isFinite(n)) n = def;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  };
  return {
    plotterIP: ip,
    plotterPort: port,
    cortesDir: typeof c.cortesDir === 'string' ? c.cortesDir.trim() : DEFAULTS.cortesDir,
    activo: c.activo === undefined ? DEFAULTS.activo : !!c.activo,
    qrSizeMm: num(c.qrSizeMm, DEFAULTS.qrSizeMm, 3, 40),
    qrBottomMm: num(c.qrBottomMm, DEFAULTS.qrBottomMm, 1, 100),
    qrCentered: c.qrCentered === undefined ? DEFAULTS.qrCentered : !!c.qrCentered,
    // Prefijo saneado a caracteres QR/filesystem-safe (sin espacios ni acentos).
    cutPrefix: typeof c.cutPrefix === 'string'
      ? c.cutPrefix.trim().replace(/[^A-Za-z0-9_-]/g, '')
      : DEFAULTS.cutPrefix,
  };
}

function load() {
  const file = getFilePath();
  if (!fs.existsSync(file)) return { ...DEFAULTS };
  try {
    return sanitize(JSON.parse(fs.readFileSync(file, 'utf-8')));
  } catch (err) {
    console.error('[qrcut] no se pudo leer la config:', err);
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
