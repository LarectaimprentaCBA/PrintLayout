// Config del servicio de "entrada automática" de pedidos de fotos.
//
// Vive SOLO en userData/intake-config.json (NUNCA en el repo/bundle): contiene
// la service key secreta de Supabase. Es una PC de un único usuario (taller),
// así que la clave queda en claro en su userData (igual criterio que el resto
// de configs locales).
//
// Forma: { supabaseUrl, serviceKey, pollSeconds, outputDir, activo }.

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FILENAME = 'intake-config.json';
const MIN_POLL = 15;
const DEFAULTS = {
  supabaseUrl: '',
  serviceKey: '',
  pollSeconds: 60,
  outputDir: '',
  activo: false,
  // "Esta PC es de La Recta": habilita bajar pedidos y administrar/publicar
  // plantillas oficiales. En las demás PCs queda en false (panel oculto).
  laRecta: false,
};

function getFilePath() {
  return path.join(app.getPath('userData'), FILENAME);
}

function sanitize(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  let poll = Number(c.pollSeconds);
  if (!Number.isFinite(poll)) poll = DEFAULTS.pollSeconds;
  poll = Math.max(MIN_POLL, Math.floor(poll));
  return {
    // Sin barra final, así concatenar rutas REST/Storage es predecible.
    supabaseUrl: typeof c.supabaseUrl === 'string' ? c.supabaseUrl.trim().replace(/\/+$/, '') : '',
    serviceKey: typeof c.serviceKey === 'string' ? c.serviceKey.trim() : '',
    pollSeconds: poll,
    outputDir: typeof c.outputDir === 'string' ? c.outputDir : '',
    activo: !!c.activo,
    laRecta: !!c.laRecta,
  };
}

// "Modo La Recta": esta PC administra. Requiere la clave secreta presente Y el
// flag explícito. Sin esto, el panel de pedidos y las acciones de admin se
// ocultan, y las plantillas oficiales quedan solo-lectura.
function isLaRecta(cfg) {
  const c = cfg || load();
  return !!(c.serviceKey && c.laRecta);
}

function load() {
  const file = getFilePath();
  if (!fs.existsSync(file)) return { ...DEFAULTS };
  try {
    return sanitize(JSON.parse(fs.readFileSync(file, 'utf-8')));
  } catch (err) {
    console.error('[intake] no se pudo leer la config:', err);
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

module.exports = { load, save, isLaRecta, MIN_POLL, DEFAULTS };
