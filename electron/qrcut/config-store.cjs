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
  return {
    plotterIP: ip,
    plotterPort: port,
    cortesDir: typeof c.cortesDir === 'string' ? c.cortesDir.trim() : DEFAULTS.cortesDir,
    activo: c.activo === undefined ? DEFAULTS.activo : !!c.activo,
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
