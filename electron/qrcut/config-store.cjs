// Config del "Servidor de corte QR" (nuestra File Center, reemplazo de
// QRFileCut.exe). Vive SOLO en userData/qrcut-config.json (no en el repo/bundle),
// así persiste entre reinicios y no se pierde como pasaba con el programa chino.
//
// Forma: { plotterIP, plotterPort, cortesDir, activo, qrSizeMm, qrBottomMm,
//          qrCentered, cutPrefix, relayActivo, relayPort, relayAllowlistCidr,
//          plotterSettleMs }.
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
  // Nombre de ESTA máquina/PC (ej. "PC 1", "Mostrador"). Se usa como nombre del
  // trabajo de impresión: "<machineName> - <solapa>", así en la cola de la
  // impresora se ve de qué PC y qué trabajo salió. Vacío = solo la solapa.
  machineName: '',
  // --- Portero / relay de cortes (multiplexar el plotter desde varias PC) ---
  // Esta PC (la conectada al plotter) escucha en 0.0.0.0:relayPort y reenvía los
  // cortes de emisores externos (otra PC / Corel / otro software) al plotter,
  // coordinando con el server QR + el envío directo por el candado único. En las
  // PC emisoras se DESTILDA (igual que `activo`): ellas apuntan su IP destino a
  // esta PC y no hacen de portero.
  relayActivo: true,
  relayPort: 8080,
  // Solo se aceptan conexiones de estas IP (loopback siempre permitido).
  relayAllowlistCidr: '192.168.100.0/24',
  // Tiempo de asentamiento del plotter en las transiciones de dueño del candado
  // (ms). Al soltar el server QR / pasar el turno, esperamos esto antes de que el
  // nuevo productor escriba (o antes de reconectar el QR) para que el plotter
  // libere/termine al anterior y no descarte los bytes. Subir si un plotter
  // necesita más; 0 = sin espera.
  plotterSettleMs: 1200,
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
    // Nombre de máquina: texto libre (se muestra en la cola de impresión). Se
    // limpian saltos de línea (romperían el protocolo del helper) y se acota.
    machineName: typeof c.machineName === 'string'
      ? c.machineName.replace(/[\r\n]+/g, ' ').trim().slice(0, 60)
      : DEFAULTS.machineName,
    relayActivo: c.relayActivo === undefined ? DEFAULTS.relayActivo : !!c.relayActivo,
    relayPort: (() => {
      let p = Number(c.relayPort);
      if (!Number.isInteger(p) || p <= 0 || p > 65535) p = DEFAULTS.relayPort;
      return p;
    })(),
    relayAllowlistCidr: typeof c.relayAllowlistCidr === 'string' && c.relayAllowlistCidr.trim()
      ? c.relayAllowlistCidr.trim()
      : DEFAULTS.relayAllowlistCidr,
    plotterSettleMs: num(c.plotterSettleMs, DEFAULTS.plotterSettleMs, 0, 10000),
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
