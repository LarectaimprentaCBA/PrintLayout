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

// Upsert del catálogo de planchas (PrintLayout es la fuente de verdad). La tabla
// `planchas_catalogo` tiene `id` como PK; merge-duplicates = insertar o pisar.
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
};
