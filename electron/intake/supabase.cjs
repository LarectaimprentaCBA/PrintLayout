// Cliente mínimo de Supabase para el servicio de intake (proceso main).
//
// Usa el fetch de Electron (net.fetch) con un User-Agent de SERVIDOR: Supabase
// rechaza la service key si el request parece venir de un navegador.
//
// Solo lo que necesitamos: listar pedidos pendientes, bajar/borrar objetos del
// Storage privado y marcar un pedido como procesado.

const { net } = require('electron');

const SERVER_UA = 'PrintLayout-Desktop/1.0 (+server)';

function assertCfg(cfg) {
  if (!cfg || !cfg.supabaseUrl) throw new Error('Falta la URL de Supabase.');
  if (!cfg.serviceKey) throw new Error('Falta la service key de Supabase.');
}

function authHeaders(cfg) {
  return {
    apikey: cfg.serviceKey,
    Authorization: `Bearer ${cfg.serviceKey}`,
    'User-Agent': SERVER_UA,
  };
}

// Codifica cada segmento del path del objeto (orderId/uuid.jpg) sin romper las
// barras.
function encodeObjectPath(p) {
  return String(p)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

async function readErr(res, prefix) {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300);
  } catch (_) {
    /* ignore */
  }
  return new Error(`${prefix} ${res.status}${detail ? `: ${detail}` : ''}`);
}

// Pedidos pendientes: no procesados Y con número de presupuesto asignado (el
// CRM lo carga antes de que nosotros procesemos). Orden por antigüedad.
async function listPendingOrders(cfg, { limit } = {}) {
  assertCfg(cfg);
  const q = new URLSearchParams();
  q.set('procesado_printlayout', 'is.false');
  q.set('numero_presupuesto', 'not.is.null');
  q.set('order', 'created_at.asc');
  q.set('select', '*');
  if (limit) q.set('limit', String(limit));
  const url = `${cfg.supabaseUrl}/rest/v1/pedido_fotos?${q.toString()}`;
  const res = await net.fetch(url, {
    method: 'GET',
    headers: { ...authHeaders(cfg), Accept: 'application/json' },
  });
  if (!res.ok) throw await readErr(res, 'REST list');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Baja un objeto del bucket privado `fotos`. Devuelve un Buffer.
async function downloadObject(cfg, objectPath) {
  assertCfg(cfg);
  const url = `${cfg.supabaseUrl}/storage/v1/object/fotos/${encodeObjectPath(objectPath)}`;
  const res = await net.fetch(url, { method: 'GET', headers: authHeaders(cfg) });
  if (!res.ok) throw await readErr(res, `Storage GET (${objectPath})`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

// Marca el pedido como procesado. Idempotente (volver a marcarlo no falla).
async function markProcessed(cfg, id) {
  assertCfg(cfg);
  const url = `${cfg.supabaseUrl}/rest/v1/pedido_fotos?id=eq.${encodeURIComponent(id)}`;
  const res = await net.fetch(url, {
    method: 'PATCH',
    headers: {
      ...authHeaders(cfg),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ procesado_printlayout: true }),
  });
  if (!res.ok) throw await readErr(res, 'REST patch');
  return true;
}

// Borra objetos del bucket `fotos` (bulk). Mismo endpoint que usa el SDK:
// DELETE /storage/v1/object/<bucket> con { prefixes: [...] }.
async function removeObjects(cfg, paths) {
  assertCfg(cfg);
  const list = (paths || []).filter(Boolean);
  if (list.length === 0) return true;
  const url = `${cfg.supabaseUrl}/storage/v1/object/fotos`;
  const res = await net.fetch(url, {
    method: 'DELETE',
    headers: { ...authHeaders(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: list }),
  });
  if (!res.ok) throw await readErr(res, 'Storage DELETE');
  return true;
}

// ---- Dobble: tabla `pedido_dobble` + bucket privado `dobble` ----
// Mismas credenciales/criterios que fotos; sólo cambian la tabla y el bucket.
// La receta es un ARCHIVO en Storage (imágenes inline, varios MB), NO una
// columna jsonb: se baja como objeto igual que una foto.

// Pedidos Dobble pendientes: no procesados Y con número de presupuesto asignado
// (esperamos al CRM, igual que fotos). Orden por presupuesto (proxy cronológico).
async function listPendingDobble(cfg, { limit } = {}) {
  assertCfg(cfg);
  const q = new URLSearchParams();
  q.set('procesado_printlayout', 'is.false');
  q.set('numero_presupuesto', 'not.is.null');
  q.set('order', 'numero_presupuesto.asc');
  q.set('select', '*');
  if (limit) q.set('limit', String(limit));
  const url = `${cfg.supabaseUrl}/rest/v1/pedido_dobble?${q.toString()}`;
  const res = await net.fetch(url, {
    method: 'GET',
    headers: { ...authHeaders(cfg), Accept: 'application/json' },
  });
  if (!res.ok) throw await readErr(res, 'REST list dobble');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Baja un objeto del bucket privado `dobble` (<id>/receta.json o <id>/caja.jpg).
async function downloadDobbleObject(cfg, objectPath) {
  assertCfg(cfg);
  const url = `${cfg.supabaseUrl}/storage/v1/object/dobble/${encodeObjectPath(objectPath)}`;
  const res = await net.fetch(url, { method: 'GET', headers: authHeaders(cfg) });
  if (!res.ok) throw await readErr(res, `Storage GET dobble (${objectPath})`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

// Marca el pedido Dobble como procesado. Idempotente.
async function markProcessedDobble(cfg, id) {
  assertCfg(cfg);
  const url = `${cfg.supabaseUrl}/rest/v1/pedido_dobble?id=eq.${encodeURIComponent(id)}`;
  const res = await net.fetch(url, {
    method: 'PATCH',
    headers: {
      ...authHeaders(cfg),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ procesado_printlayout: true }),
  });
  if (!res.ok) throw await readErr(res, 'REST patch dobble');
  return true;
}

// Borra objetos del bucket `dobble` (bulk).
async function removeDobbleObjects(cfg, paths) {
  assertCfg(cfg);
  const list = (paths || []).filter(Boolean);
  if (list.length === 0) return true;
  const url = `${cfg.supabaseUrl}/storage/v1/object/dobble`;
  const res = await net.fetch(url, {
    method: 'DELETE',
    headers: { ...authHeaders(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: list }),
  });
  if (!res.ok) throw await readErr(res, 'Storage DELETE dobble');
  return true;
}

// ---- Rótulos: tabla `pedido_rotulo` (receta INLINE, sin bucket) ----
// El cliente no sube archivos: la receta viene en la propia fila. El arte y la
// fuente ya están en el catálogo local/compartido de esta PC. Sólo listamos los
// pendientes y marcamos procesado — no hay descarga ni borrado de Storage.

// Pedidos de rótulos pendientes: no procesados Y con número de presupuesto
// asignado (esperamos al CRM, igual que fotos/dobble). Orden por presupuesto.
async function listPendingRotulos(cfg, { limit } = {}) {
  assertCfg(cfg);
  const q = new URLSearchParams();
  q.set('procesado_printlayout', 'is.false');
  q.set('numero_presupuesto', 'not.is.null');
  q.set('order', 'numero_presupuesto.asc');
  q.set('select', '*');
  if (limit) q.set('limit', String(limit));
  const url = `${cfg.supabaseUrl}/rest/v1/pedido_rotulo?${q.toString()}`;
  const res = await net.fetch(url, {
    method: 'GET',
    headers: { ...authHeaders(cfg), Accept: 'application/json' },
  });
  if (!res.ok) throw await readErr(res, 'REST list rotulo');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Marca el pedido de rótulos como procesado. Idempotente.
async function markProcessedRotulos(cfg, id) {
  assertCfg(cfg);
  const url = `${cfg.supabaseUrl}/rest/v1/pedido_rotulo?id=eq.${encodeURIComponent(id)}`;
  const res = await net.fetch(url, {
    method: 'PATCH',
    headers: {
      ...authHeaders(cfg),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ procesado_printlayout: true }),
  });
  if (!res.ok) throw await readErr(res, 'REST patch rotulo');
  return true;
}

// Upsert del catálogo de planchas (PrintLayout es la fuente de verdad). La tabla
// `planchas_catalogo` tiene `id` como PK; merge-duplicates = insertar o pisar.
// Cada row la arma `catalogRowForTemplate` (renderer) y va tal cual: además del
// tamaño de la foto (wmm/hmm) incluye la geometría del marco —`marco_wmm`,
// `marco_hmm`, `foto_left_mm`, `foto_top_mm` (null si la foto va a sangre)— para
// que la web dibuje la plancha real. Esas columnas deben existir en la tabla.
async function upsertCatalog(cfg, rows) {
  assertCfg(cfg);
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return true;
  const url = `${cfg.supabaseUrl}/rest/v1/planchas_catalogo`;
  const res = await net.fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(cfg),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(list),
  });
  if (!res.ok) throw await readErr(res, 'Catálogo upsert');
  return true;
}

// ---- Rótulos: catálogo de modelos (tabla `modelos_rotulos` + bucket público
// `rotulos-modelos`). PrintLayout es la fuente de verdad; la web /rotulos lo lee.

// Sube (o pisa, x-upsert) un objeto a un bucket. objectPath = '<modelId>/<size>.<ext>'.
async function uploadPublicObject(cfg, bucket, objectPath, buffer, contentType) {
  assertCfg(cfg);
  const url = `${cfg.supabaseUrl}/storage/v1/object/${bucket}/${encodeObjectPath(objectPath)}`;
  const res = await net.fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(cfg),
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!res.ok) throw await readErr(res, `Storage upload (${objectPath})`);
  return true;
}

// URL pública de un objeto de un bucket público.
function publicObjectUrl(cfg, bucket, objectPath) {
  return `${cfg.supabaseUrl}/storage/v1/object/public/${bucket}/${encodeObjectPath(objectPath)}`;
}

// Upsert de filas del catálogo de modelos de rótulos (PK id, merge-duplicates).
async function upsertModelosRotulos(cfg, rows) {
  assertCfg(cfg);
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return true;
  const url = `${cfg.supabaseUrl}/rest/v1/modelos_rotulos`;
  const res = await net.fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(cfg),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(list),
  });
  if (!res.ok) throw await readErr(res, 'modelos_rotulos upsert');
  return true;
}

// Upsert de filas del catálogo de tipografías de rótulos (PK id, merge-duplicates).
async function upsertTipografiasRotulos(cfg, rows) {
  assertCfg(cfg);
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return true;
  const url = `${cfg.supabaseUrl}/rest/v1/tipografias_rotulos`;
  const res = await net.fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(cfg),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(list),
  });
  if (!res.ok) throw await readErr(res, 'tipografias_rotulos upsert');
  return true;
}

// Upsert de filas del catálogo de mazos "busca2" (PK id, merge-duplicates).
// PrintLayout es la fuente de verdad; la web /busca2 lo lee.
async function upsertMazosBusca2(cfg, rows) {
  assertCfg(cfg);
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return true;
  const url = `${cfg.supabaseUrl}/rest/v1/mazos_busca2`;
  const res = await net.fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(cfg),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(list),
  });
  if (!res.ok) throw await readErr(res, 'mazos_busca2 upsert');
  return true;
}

// Lista todas las fichas del catálogo de mazos "busca2" (orden por `orden`).
async function listMazosBusca2(cfg) {
  assertCfg(cfg);
  const q = new URLSearchParams();
  q.set('select', '*');
  q.set('order', 'orden.asc');
  const url = `${cfg.supabaseUrl}/rest/v1/mazos_busca2?${q.toString()}`;
  const res = await net.fetch(url, {
    method: 'GET',
    headers: { ...authHeaders(cfg), Accept: 'application/json' },
  });
  if (!res.ok) throw await readErr(res, 'mazos_busca2 list');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Edita campos de una ficha (PATCH por id). `fields` = solo lo que cambia.
async function patchMazoBusca2(cfg, id, fields) {
  assertCfg(cfg);
  const url = `${cfg.supabaseUrl}/rest/v1/mazos_busca2?id=eq.${encodeURIComponent(id)}`;
  const res = await net.fetch(url, {
    method: 'PATCH',
    headers: {
      ...authHeaders(cfg),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(fields || {}),
  });
  if (!res.ok) throw await readErr(res, 'mazos_busca2 patch');
  return true;
}

// Borra una ficha del catálogo (DELETE por id). Idempotente.
async function deleteMazoBusca2(cfg, id) {
  assertCfg(cfg);
  const url = `${cfg.supabaseUrl}/rest/v1/mazos_busca2?id=eq.${encodeURIComponent(id)}`;
  const res = await net.fetch(url, {
    method: 'DELETE',
    headers: { ...authHeaders(cfg), Prefer: 'return=minimal' },
  });
  if (!res.ok) throw await readErr(res, 'mazos_busca2 delete');
  return true;
}

// Borra objetos de un bucket público (DELETE /storage/v1/object/<bucket>).
async function removePublicObject(cfg, bucket, objectPaths) {
  assertCfg(cfg);
  const list = (Array.isArray(objectPaths) ? objectPaths : [objectPaths]).filter(Boolean);
  if (list.length === 0) return true;
  const url = `${cfg.supabaseUrl}/storage/v1/object/${bucket}`;
  const res = await net.fetch(url, {
    method: 'DELETE',
    headers: { ...authHeaders(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: list }),
  });
  if (!res.ok) throw await readErr(res, `Storage DELETE (${bucket})`);
  return true;
}

// Upsert de una clave de configuración (tabla key-value `config_fotos`, PK clave).
async function upsertConfig(cfg, clave, valor) {
  assertCfg(cfg);
  const url = `${cfg.supabaseUrl}/rest/v1/config_fotos`;
  const res = await net.fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(cfg),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([{ clave, valor }]),
  });
  if (!res.ok) throw await readErr(res, 'config_fotos upsert');
  return true;
}

module.exports = {
  SERVER_UA,
  listPendingOrders,
  downloadObject,
  markProcessed,
  removeObjects,
  upsertCatalog,
  upsertConfig,
  // Rótulos
  uploadPublicObject,
  publicObjectUrl,
  upsertModelosRotulos,
  upsertTipografiasRotulos,
  upsertMazosBusca2,
  listMazosBusca2,
  patchMazoBusca2,
  deleteMazoBusca2,
  removePublicObject,
  // Dobble
  listPendingDobble,
  downloadDobbleObject,
  markProcessedDobble,
  removeDobbleObjects,
  // Rótulos (pedidos con receta inline)
  listPendingRotulos,
  markProcessedRotulos,
};
