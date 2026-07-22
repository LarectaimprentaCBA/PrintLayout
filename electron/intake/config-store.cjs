// Config del servicio de "entrada automática" de pedidos de fotos.
//
// Vive SOLO en userData/intake-config.json (NUNCA en el repo/bundle): contiene
// la service key secreta de Supabase. Es una PC de un único usuario (taller),
// así que la clave queda en claro en su userData (igual criterio que el resto
// de configs locales).
//
// Forma: { supabaseUrl, serviceKey, pollSeconds, outputDir, activo, laRecta,
//          modoEntrega, dobbleActive, dobbleComboTemplateId, dobbleOutputDir,
//          dobbleBackMirror, dobbleBackRotate180, rotulosActive,
//          rotulosOutputDir }.

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
  // Qué hacer al recibir un pedido: 'abrir' (abre cada hoja en una pestaña para
  // revisar) o 'carpeta' (guarda un .pljob por hoja en <outputDir>/Pedidos sin
  // abrir pestañas). Default 'carpeta'.
  modoEntrega: 'carpeta',
  // --- Pedidos Dobble (exportador TOTALMENTE automático) ---
  // Toggle "Procesar pedidos Dobble". Independiente del intake de fotos: se
  // pollea en el mismo ciclo pero sólo si está activo.
  dobbleActive: false,
  // Plantilla combo (pages=[A,A,B]) guardada sobre la que se posa SIEMPRE.
  dobbleComboTemplateId: '',
  // Carpeta donde se deja el PDF final (doble faz) de cada pedido Dobble.
  dobbleOutputDir: '',
  // Mazos NUESTROS (origen 'catalogo'): mapa mazo_id → ruta del PDF ya armado.
  // En vez de generar, se copia ese PDF a la carpeta de salida.
  dobbleMazoPdfMap: {},
  // Ubicación del DORSO en el doble faz del combo automático (mazos del cliente).
  // Espejo: 'x' = izquierda-derecha ("libro", voltea por el lado largo, default);
  // 'y' = arriba-abajo (voltea por el lado corto). Rotar 180° es independiente.
  // El combo guardado puede no traer estos campos → se estampan al posar.
  dobbleBackMirror: 'x',
  dobbleBackRotate180: false,
  // --- Pedidos Rótulos (exportador automático) ---
  // Toggle "Procesar pedidos de rótulos". Independiente del intake de fotos y de
  // Dobble: se pollea en el mismo ciclo pero sólo si está activo. La receta viene
  // INLINE en la fila (no baja nada del bucket): el arte y la fuente ya están en
  // el catálogo local/compartido (se publicaron desde esta PC).
  rotulosActive: false,
  // Carpeta donde se deja el PDF de cada pedido de rótulos.
  rotulosOutputDir: '',
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
    modoEntrega: c.modoEntrega === 'abrir' ? 'abrir' : 'carpeta',
    dobbleActive: !!c.dobbleActive,
    dobbleComboTemplateId: typeof c.dobbleComboTemplateId === 'string' ? c.dobbleComboTemplateId : '',
    dobbleOutputDir: typeof c.dobbleOutputDir === 'string' ? c.dobbleOutputDir : '',
    dobbleMazoPdfMap: (c.dobbleMazoPdfMap && typeof c.dobbleMazoPdfMap === 'object' && !Array.isArray(c.dobbleMazoPdfMap))
      ? Object.fromEntries(
        Object.entries(c.dobbleMazoPdfMap)
          .filter(([, v]) => typeof v === 'string' && v.trim())
          .map(([k, v]) => [String(k), v]),
      )
      : {},
    dobbleBackMirror: c.dobbleBackMirror === 'y' ? 'y' : 'x',
    dobbleBackRotate180: !!c.dobbleBackRotate180,
    rotulosActive: !!c.rotulosActive,
    rotulosOutputDir: typeof c.rotulosOutputDir === 'string' ? c.rotulosOutputDir : '',
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
