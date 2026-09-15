// Sync de calibraciones de color con GitHub (mismo repo y token que las plantillas).
//
// Repo: LarectaimprentaCBA/PrintLayout-templates (publico)
// - calibraciones/manifest.json: { version, calibraciones: [{ id, correctIp, hash, updatedAt, active, file }] }
// - calibraciones/{id}.json: { id, engineVersion, correctIp, referenceIp, paperName, lutSize, lut, results, active, createdAt, updatedAt }
//
// Solo se sube la TABLA y los METADATOS: nada de clientes ni nombres de PC/cola (esos son
// per-PC). El nombre de cola local se resuelve por IP en cada PC. Conflictos: gana la más
// nueva (updatedAt). Pull anonimo (repo publico); push/borrado requieren token.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OWNER = 'LarectaimprentaCBA';
const REPO = 'PrintLayout-templates';
const BRANCH = 'main';
const MANIFEST_PATH = 'calibraciones/manifest.json';
const API = 'https://api.github.com';

let cachedFetch = null;
function getFetch() {
  if (cachedFetch) return cachedFetch;
  try {
    const electron = require('electron');
    if (electron && electron.net && electron.net.fetch) { cachedFetch = electron.net.fetch.bind(electron.net); return cachedFetch; }
  } catch { /* no electron */ }
  cachedFetch = global.fetch;
  return cachedFetch;
}

let cachedToken = null;
function getToken() {
  if (cachedToken !== null) return cachedToken;
  const candidates = [
    path.join(__dirname, '..', 'templates-config.json'),
    path.join(process.resourcesPath || '', 'app.asar', 'electron', 'templates-config.json'),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (cfg && cfg.token) { cachedToken = cfg.token; return cachedToken; }
      }
    } catch (err) { /* ignore */ }
  }
  cachedToken = '';
  return cachedToken;
}

function authHeaders() {
  const token = getToken();
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'PrintLayout-color-sync' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// Campos que definen el contenido (para detectar cambios). Incluye `active` porque
// activar/desactivar debe viajar al compartir.
function hashCalibrationContent(cal) {
  const stable = {
    correctIp: cal.correctIp || (cal.correctPrinter && cal.correctPrinter.ip) || '',
    referenceIp: cal.referenceIp || (cal.referencePrinter && cal.referencePrinter.ip) || '',
    paperName: cal.paperName || '',
    lutSize: cal.lutSize || 17,
    lut: cal.lut || [],
    active: !!cal.active,
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

// Convierte una calibración local en el objeto a subir (sin colas ni datos de PC).
function toShared(cal) {
  return {
    id: cal.id,
    engineVersion: cal.engineVersion || 1,
    correctIp: (cal.correctPrinter && cal.correctPrinter.ip) || cal.correctIp || '',
    referenceIp: (cal.referencePrinter && cal.referencePrinter.ip) || cal.referenceIp || '',
    paperName: cal.paperName || '',
    lutSize: cal.lutSize || 17,
    lut: cal.lut || [],
    results: cal.results || null,
    active: !!cal.active,
    origen: cal.origen || null,
    archivoOrigen: cal.archivoOrigen || null,
    createdAt: cal.createdAt || new Date().toISOString(),
    updatedAt: cal.updatedAt || new Date().toISOString(),
  };
}

async function fetchContent(filePath) {
  const fetchFn = getFetch();
  const url = `${API}/repos/${OWNER}/${REPO}/contents/${filePath}?ref=${BRANCH}`;
  const r = await fetchFn(url, { headers: authHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${filePath} -> ${r.status}`);
  const meta = await r.json();
  if (meta && meta.content) return Buffer.from(meta.content, 'base64').toString('utf-8');
  if (meta && meta.sha) {
    const br = await fetchFn(`${API}/repos/${OWNER}/${REPO}/git/blobs/${meta.sha}`, { headers: authHeaders() });
    if (!br.ok) throw new Error(`GET blob ${meta.sha} -> ${br.status}`);
    const blob = await br.json();
    if (!blob || !blob.content) return null;
    return Buffer.from(blob.content, 'base64').toString('utf-8');
  }
  return null;
}

async function getFileMeta(filePath) {
  const fetchFn = getFetch();
  const r = await fetchFn(`${API}/repos/${OWNER}/${REPO}/contents/${filePath}?ref=${BRANCH}`, { headers: authHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET contents ${filePath} -> ${r.status}`);
  return await r.json();
}

async function putFile(filePath, contentString, message, prevSha) {
  if (!getToken()) throw new Error('Token de sync no configurado.');
  const fetchFn = getFetch();
  const body = { message, content: Buffer.from(contentString, 'utf-8').toString('base64'), branch: BRANCH };
  if (prevSha) body.sha = prevSha;
  const r = await fetchFn(`${API}/repos/${OWNER}/${REPO}/contents/${filePath}`, {
    method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (r.status === 409 || r.status === 422) { const t = await r.text(); const e = new Error(`conflict: ${r.status} ${t}`); e.conflict = true; throw e; }
  if (!r.ok) { const t = await r.text(); throw new Error(`PUT ${filePath} -> ${r.status} ${t}`); }
  return await r.json();
}

async function deleteFile(filePath, message, sha) {
  if (!getToken()) throw new Error('Token de sync no configurado.');
  const fetchFn = getFetch();
  const r = await fetchFn(`${API}/repos/${OWNER}/${REPO}/contents/${filePath}`, {
    method: 'DELETE', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sha, branch: BRANCH }),
  });
  if (r.status === 409 || r.status === 422) { const t = await r.text(); const e = new Error(`conflict: ${r.status} ${t}`); e.conflict = true; throw e; }
  if (!r.ok) { const t = await r.text(); throw new Error(`DELETE ${filePath} -> ${r.status} ${t}`); }
  return await r.json();
}

async function fetchManifest() {
  const text = await fetchContent(MANIFEST_PATH);
  if (!text) return { version: 1, calibraciones: [] };
  try { const m = JSON.parse(text); return { version: m.version || 1, calibraciones: Array.isArray(m.calibraciones) ? m.calibraciones : [] }; }
  catch (err) { throw new Error(`manifest de calibraciones invalido: ${err.message}`); }
}

async function push(cal) {
  if (!getToken()) return { ok: false, error: 'Token no configurado en este build.' };
  if (!cal || !cal.id) return { ok: false, error: 'La calibración no tiene id.' };
  const shared = toShared(cal);
  const hash = hashCalibrationContent(shared);
  const file = `calibraciones/${cal.id}.json`;
  const existing = await getFileMeta(file).catch(() => null);
  await putFile(file, JSON.stringify(shared, null, 2), existing ? `Update calibracion ${cal.id}` : `Add calibracion ${cal.id}`, existing && existing.sha);

  for (let attempt = 0; attempt < 3; attempt++) {
    const manifestMeta = await getFileMeta(MANIFEST_PATH).catch(() => null);
    const current = manifestMeta ? JSON.parse(Buffer.from(manifestMeta.content, 'base64').toString('utf-8')) : { version: 1, calibraciones: [] };
    const list = Array.isArray(current.calibraciones) ? current.calibraciones : [];
    const idx = list.findIndex((c) => c.id === cal.id);
    const entry = { id: cal.id, correctIp: shared.correctIp, hash, updatedAt: shared.updatedAt, active: shared.active, file };
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    try {
      await putFile(MANIFEST_PATH, JSON.stringify({ version: 1, calibraciones: list }, null, 2), `Manifest calibraciones: ${cal.id}`, manifestMeta && manifestMeta.sha);
      return { ok: true, hash, updatedAt: shared.updatedAt };
    } catch (err) {
      if (err.conflict && attempt < 2) { await new Promise((res) => setTimeout(res, 250 * (attempt + 1))); continue; }
      return { ok: false, error: err.message };
    }
  }
  return { ok: false, error: 'No se pudo actualizar el manifest de calibraciones.' };
}

async function remove(id) {
  if (!getToken()) return { ok: false, error: 'Token no configurado en este build.' };
  if (!id) return { ok: false, error: 'Falta el id.' };
  const file = `calibraciones/${id}.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const manifestMeta = await getFileMeta(MANIFEST_PATH).catch(() => null);
    if (!manifestMeta) break;
    const current = JSON.parse(Buffer.from(manifestMeta.content, 'base64').toString('utf-8'));
    const list = Array.isArray(current.calibraciones) ? current.calibraciones : [];
    const idx = list.findIndex((c) => c.id === id);
    if (idx < 0) break;
    list.splice(idx, 1);
    try {
      await putFile(MANIFEST_PATH, JSON.stringify({ version: 1, calibraciones: list }, null, 2), `Manifest calibraciones: remove ${id}`, manifestMeta.sha);
      break;
    } catch (err) {
      if (err.conflict && attempt < 2) { await new Promise((res) => setTimeout(res, 250 * (attempt + 1))); continue; }
      return { ok: false, error: `No se pudo actualizar el manifest: ${err.message}` };
    }
  }
  try { const meta = await getFileMeta(file).catch(() => null); if (meta && meta.sha) await deleteFile(file, `Delete calibracion ${id}`, meta.sha); }
  catch (err) { /* archivo huerfano inocuo */ }
  return { ok: true };
}

async function listRemote() { const m = await fetchManifest(); return m.calibraciones || []; }
async function pull(id) { const t = await fetchContent(`calibraciones/${id}.json`); return t ? JSON.parse(t) : null; }
function hasToken() { return !!getToken(); }

module.exports = { hashCalibrationContent, toShared, listRemote, pull, push, remove, hasToken };
