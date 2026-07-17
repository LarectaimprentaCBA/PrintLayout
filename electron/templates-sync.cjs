// Sync de plantillas con GitHub.
//
// Repo: LarectaimprentaCBA/PrintLayout-templates (publico)
// - manifest.json: { version, templates: [{ id, name, hash, updatedAt, file }] }
// - templates/{id}.json: contenido completo de la plantilla
//
// Pull no requiere token (repo publico). Push si.
// El token viene de electron/templates-config.json (escrito en build-time
// desde la env var PRINTLAYOUT_TEMPLATES_TOKEN). Sin token, pushTemplate
// devuelve error y la UI deshabilita el boton.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OWNER = 'LarectaimprentaCBA';
const REPO = 'PrintLayout-templates';
const BRANCH = 'main';
const MANIFEST_PATH = 'manifest.json';
const API = 'https://api.github.com';

// Usamos Electron net.fetch cuando estamos dentro de la app: respeta el
// system CA store y los proxies, evitando el bug de certs custom de la red
// del usuario. Fuera de Electron (smoke test en Node), caemos al fetch global
// (que requiere NODE_OPTIONS=--use-system-ca para resolver lo mismo).
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
    // No es entorno Electron.
  }
  cachedFetch = global.fetch;
  return cachedFetch;
}

let cachedToken = null;
function getToken() {
  if (cachedToken !== null) return cachedToken;
  // En dev, el archivo puede no existir; en build queda dentro del asar.
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
      console.warn('[templates-sync] no se pudo leer config:', err.message);
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
    'User-Agent': 'PrintLayout-sync',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// Hash estable: serializa los campos de contenido en orden, sin metadata
// volatil (createdAt/updatedAt/sharedAt). Asi cambios de timestamp solos no
// disparan re-sync.
function hashTemplateContent(tpl) {
  const stable = {
    name: tpl.name,
    pdfBase64: tpl.pdfBase64,
    pageWidthMm: tpl.pageWidthMm,
    pageHeightMm: tpl.pageHeightMm,
    pageCount: tpl.pageCount,
    celdas: tpl.celdas,
    celdasDorso: tpl.celdasDorso ?? [],
    cortes: tpl.cortes ?? [],
    markMarginMm: tpl.markMarginMm,
    doubleSided: !!tpl.doubleSided,
    singlePage: !!tpl.singlePage,
    categoria: tpl.categoria || '',
    safetyMm: Number.isFinite(tpl.safetyMm) ? tpl.safetyMm : null,
    // Estado de catálogo: incluirlo en el hash hace que marcar/quitar "oficial"
    // (o cambiar el id de catálogo) cambie el hash aunque no cambien las medidas.
    // Sin esto, el pull se saltea (sharedHash igual) y las otras PCs nunca reciben
    // el candado 🔒 de la plancha oficial.
    oficial: !!tpl.oficial,
    catalogoId: tpl.catalogoId || '',
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stable))
    .digest('hex');
}

// Lee el contenido de un archivo via Contents API. Para archivos < 1 MB
// el contenido viene base64-encoded en `meta.content`. Para archivos mas
// grandes, Contents API devuelve content="" y debemos usar la Git Blobs API
// con el sha (no tiene limite de 1 MB, hasta 100 MB).
async function fetchContent(filePath) {
  const fetchFn = getFetch();
  const url = `${API}/repos/${OWNER}/${REPO}/contents/${filePath}?ref=${BRANCH}`;
  const r = await fetchFn(url, { headers: authHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${filePath} -> ${r.status}`);
  const meta = await r.json();
  if (meta?.content) {
    return Buffer.from(meta.content, 'base64').toString('utf-8');
  }
  // Contents API trunco el contenido (archivo > 1 MB). Caemos al Blobs API.
  if (meta?.sha) {
    const blobUrl = `${API}/repos/${OWNER}/${REPO}/git/blobs/${meta.sha}`;
    const br = await fetchFn(blobUrl, { headers: authHeaders() });
    if (!br.ok) throw new Error(`GET blob ${meta.sha} -> ${br.status}`);
    const blob = await br.json();
    if (!blob?.content) return null;
    return Buffer.from(blob.content, 'base64').toString('utf-8');
  }
  return null;
}

async function fetchManifest() {
  const text = await fetchContent(MANIFEST_PATH);
  if (!text) return { version: 1, templates: [] };
  try {
    const m = JSON.parse(text);
    return {
      version: m.version ?? 1,
      templates: Array.isArray(m.templates) ? m.templates : [],
    };
  } catch (err) {
    throw new Error(`manifest.json invalido: ${err.message}`);
  }
}

async function fetchTemplate(id) {
  const text = await fetchContent(`templates/${id}.json`);
  if (!text) return null;
  return JSON.parse(text);
}

// Contents API: para crear o actualizar un archivo necesitamos el sha actual
// (si existe). Devolvemos { sha, content } o null si no existe.
async function getFileMeta(filePath) {
  const fetchFn = getFetch();
  const url = `${API}/repos/${OWNER}/${REPO}/contents/${filePath}?ref=${BRANCH}`;
  const r = await fetchFn(url, { headers: authHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET contents ${filePath} -> ${r.status}`);
  return await r.json();
}

async function putFile(filePath, contentString, message, prevSha) {
  if (!getToken()) throw new Error('Token de sync no configurado.');
  const fetchFn = getFetch();
  const url = `${API}/repos/${OWNER}/${REPO}/contents/${filePath}`;
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
    throw new Error(`PUT ${filePath} -> ${r.status} ${txt}`);
  }
  return await r.json();
}

// Borra un archivo del repo via Contents API. Necesita el sha actual.
async function deleteFile(filePath, message, sha) {
  if (!getToken()) throw new Error('Token de sync no configurado.');
  const fetchFn = getFetch();
  const url = `${API}/repos/${OWNER}/${REPO}/contents/${filePath}`;
  const r = await fetchFn(url, {
    method: 'DELETE',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: BRANCH }),
  });
  if (r.status === 409 || r.status === 422) {
    const txt = await r.text();
    const err = new Error(`conflict: ${r.status} ${txt}`);
    err.conflict = true;
    throw err;
  }
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`DELETE ${filePath} -> ${r.status} ${txt}`);
  }
  return await r.json();
}

// Sube una plantilla y actualiza el manifest. Reintenta hasta 3 veces si hay
// conflicto en el manifest (otra PC pusheo entre nuestro fetch y nuestro put).
async function pushTemplate(template) {
  if (!getToken()) {
    return { ok: false, error: 'Token no configurado en este build.' };
  }
  if (!template?.id) {
    return { ok: false, error: 'La plantilla no tiene id.' };
  }
  const id = template.id;
  const hash = hashTemplateContent(template);
  const file = `templates/${id}.json`;

  // 1) Subir el archivo de la plantilla (con sha previo si existe).
  const existing = await getFileMeta(file).catch(() => null);
  const tplPayload = JSON.stringify(template, null, 2);
  await putFile(
    file,
    tplPayload,
    existing ? `Update template ${template.name}` : `Add template ${template.name}`,
    existing?.sha,
  );

  // 2) Actualizar manifest con hasta 3 reintentos en caso de conflicto.
  for (let attempt = 0; attempt < 3; attempt++) {
    const manifestMeta = await getFileMeta(MANIFEST_PATH).catch(() => null);
    const current = manifestMeta
      ? JSON.parse(Buffer.from(manifestMeta.content, 'base64').toString('utf-8'))
      : { version: 1, templates: [] };
    const list = Array.isArray(current.templates) ? current.templates : [];
    const idx = list.findIndex((t) => t.id === id);
    const entry = {
      id,
      name: template.name,
      hash,
      updatedAt: new Date().toISOString(),
      file,
    };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    const next = { version: 1, templates: list };
    try {
      await putFile(
        MANIFEST_PATH,
        JSON.stringify(next, null, 2),
        `Manifest: ${entry.name}`,
        manifestMeta?.sha,
      );
      return { ok: true, hash, updatedAt: entry.updatedAt };
    } catch (err) {
      if (err.conflict && attempt < 2) {
        // Espera escalonada y reintento.
        await new Promise((res) => setTimeout(res, 250 * (attempt + 1)));
        continue;
      }
      return { ok: false, error: err.message };
    }
  }
  return { ok: false, error: 'No se pudo actualizar el manifest tras varios intentos.' };
}

// Borra una plantilla del repo compartido: la saca del manifest (asi ninguna
// PC la vuelve a bajar en el pull) y borra el archivo templates/{id}.json.
// Sacamos primero del manifest para que, aunque el borrado del archivo falle,
// las demas PCs dejen de verla (un archivo huerfano sin entrada es inocuo).
async function deleteTemplate(id) {
  if (!getToken()) {
    return { ok: false, error: 'Token no configurado en este build.' };
  }
  if (!id) {
    return { ok: false, error: 'Falta el id de la plantilla.' };
  }
  const file = `templates/${id}.json`;

  // 1) Sacar la entrada del manifest (con reintentos si otra PC pusheo justo).
  for (let attempt = 0; attempt < 3; attempt++) {
    const manifestMeta = await getFileMeta(MANIFEST_PATH).catch(() => null);
    if (!manifestMeta) break; // no hay manifest, nada que actualizar
    const current = JSON.parse(
      Buffer.from(manifestMeta.content, 'base64').toString('utf-8'),
    );
    const list = Array.isArray(current.templates) ? current.templates : [];
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) break; // ya no figuraba en el manifest
    list.splice(idx, 1);
    const next = { version: 1, templates: list };
    try {
      await putFile(
        MANIFEST_PATH,
        JSON.stringify(next, null, 2),
        `Manifest: remove ${id}`,
        manifestMeta.sha,
      );
      break;
    } catch (err) {
      if (err.conflict && attempt < 2) {
        await new Promise((res) => setTimeout(res, 250 * (attempt + 1)));
        continue;
      }
      return { ok: false, error: `No se pudo actualizar el manifest: ${err.message}` };
    }
  }

  // 2) Borrar el archivo de la plantilla (si sigue existiendo).
  try {
    const meta = await getFileMeta(file).catch(() => null);
    if (meta?.sha) {
      await deleteFile(file, `Delete template ${id}`, meta.sha);
    }
  } catch (err) {
    // El manifest ya no la lista, asi que las otras PCs no la veran; el archivo
    // huerfano no molesta. No fallamos por esto.
    console.warn('[templates-sync] archivo quedo huerfano al borrar:', err.message);
  }

  return { ok: true };
}

// Lee el manifest remoto y devuelve la lista de plantillas remotas (sin
// bajar el contenido aun). El renderer compara con sus locales y decide.
async function listRemote() {
  const manifest = await fetchManifest();
  return manifest.templates || [];
}

// Trae el contenido completo de una plantilla remota.
async function pullTemplate(id) {
  return await fetchTemplate(id);
}

function hasToken() {
  return !!getToken();
}

module.exports = {
  hashTemplateContent,
  listRemote,
  pullTemplate,
  pushTemplate,
  deleteTemplate,
  hasToken,
};
