// Sync de presets de hoja con GitHub.
//
// Vive en el mismo repo que las plantillas (LarectaimprentaCBA/PrintLayout-templates),
// reusando el token configurado en electron/templates-config.json.
//
// A diferencia de las plantillas, los presets son objetos chicos (id, label, w, h),
// asi que guardamos todo en UN solo archivo `paper-presets.json` al root del repo:
//
//   { "version": 1, "presets": [{ "id", "label", "w", "h", "hash", "updatedAt" }] }
//
// Pull descarga ese archivo entero y devuelve la lista. Push sobrescribe el archivo
// con la lista local, con reintentos en conflict del sha (otra PC subio mientras tanto).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OWNER = 'LarectaimprentaCBA';
const REPO = 'PrintLayout-templates';
const BRANCH = 'main';
const FILE_PATH = 'paper-presets.json';
const API = 'https://api.github.com';

let cachedFetch = null;
function getFetch() {
  if (cachedFetch) return cachedFetch;
  try {
    const electron = require('electron');
    if (electron?.net?.fetch) {
      cachedFetch = electron.net.fetch.bind(electron.net);
      return cachedFetch;
    }
  } catch {
    // No es Electron.
  }
  cachedFetch = global.fetch;
  return cachedFetch;
}

let cachedToken = null;
function getToken() {
  if (cachedToken !== null) return cachedToken;
  const candidates = [
    path.join(__dirname, 'templates-config.json'),
    path.join(process.resourcesPath || '', 'app.asar', 'electron', 'templates-config.json'),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (cfg?.token) {
          cachedToken = cfg.token;
          return cachedToken;
        }
      }
    } catch (err) {
      console.warn('[paper-presets-sync] no se pudo leer config:', err.message);
    }
  }
  cachedToken = '';
  return cachedToken;
}

function authHeaders() {
  const token = getToken();
  const h = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'PrintLayout-paper-presets-sync',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// Hash estable: solo campos de contenido (no metadata volatil). Cambia si cambia
// label, w o h. Asi sync no se dispara por un renombrado de metadata interna.
function hashPresetContent(p) {
  const stable = {
    label: p.label,
    w: Number(p.w),
    h: Number(p.h),
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stable))
    .digest('hex');
}

async function getFileMeta() {
  const fetchFn = getFetch();
  const url = `${API}/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;
  const r = await fetchFn(url, { headers: authHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${FILE_PATH} -> ${r.status}`);
  return await r.json();
}

async function fetchContent() {
  const meta = await getFileMeta();
  if (!meta) return { meta: null, text: null };
  if (meta?.content) {
    return {
      meta,
      text: Buffer.from(meta.content, 'base64').toString('utf-8'),
    };
  }
  // Archivo grande: caemos a Blobs API. No deberia pasar con presets chicos.
  if (meta?.sha) {
    const fetchFn = getFetch();
    const blobUrl = `${API}/repos/${OWNER}/${REPO}/git/blobs/${meta.sha}`;
    const br = await fetchFn(blobUrl, { headers: authHeaders() });
    if (!br.ok) throw new Error(`GET blob ${meta.sha} -> ${br.status}`);
    const blob = await br.json();
    if (!blob?.content) return { meta, text: null };
    return {
      meta,
      text: Buffer.from(blob.content, 'base64').toString('utf-8'),
    };
  }
  return { meta, text: null };
}

async function listRemote() {
  const { text } = await fetchContent();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed?.presets) ? parsed.presets : [];
    return list;
  } catch (err) {
    throw new Error(`paper-presets.json invalido: ${err.message}`);
  }
}

async function putFile(contentString, message, prevSha) {
  if (!getToken()) throw new Error('Token de sync no configurado.');
  const fetchFn = getFetch();
  const url = `${API}/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`;
  const body = {
    message,
    content: Buffer.from(contentString, 'utf-8').toString('base64'),
    branch: BRANCH,
  };
  if (prevSha) body.sha = prevSha;
  const r = await fetchFn(url, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status === 409 || r.status === 422) {
    const txt = await r.text();
    const err = new Error(`conflict: ${r.status} ${txt}`);
    err.conflict = true;
    throw err;
  }
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`PUT ${FILE_PATH} -> ${r.status} ${txt}`);
  }
  return await r.json();
}

// Sube la lista entera de presets. Hasta 3 reintentos si otra PC pisó el archivo
// entre nuestro fetch y nuestro put.
async function pushAll(localPresets) {
  if (!getToken()) {
    return { ok: false, error: 'Token no configurado en este build.' };
  }
  const entries = (localPresets || []).map((p) => ({
    id: p.id,
    label: p.label,
    w: Number(p.w),
    h: Number(p.h),
    hash: hashPresetContent(p),
    updatedAt: p.updatedAt || new Date().toISOString(),
  }));

  for (let attempt = 0; attempt < 3; attempt++) {
    const { meta } = await fetchContent().catch(() => ({ meta: null }));
    const next = { version: 1, presets: entries };
    try {
      await putFile(
        JSON.stringify(next, null, 2),
        `Update paper presets (${entries.length})`,
        meta?.sha,
      );
      return { ok: true, count: entries.length, entries };
    } catch (err) {
      if (err.conflict && attempt < 2) {
        await new Promise((res) => setTimeout(res, 250 * (attempt + 1)));
        continue;
      }
      return { ok: false, error: err.message };
    }
  }
  return { ok: false, error: 'No se pudo subir tras varios intentos.' };
}

function hasToken() {
  return !!getToken();
}

module.exports = {
  hashPresetContent,
  listRemote,
  pushAll,
  hasToken,
};
