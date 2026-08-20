// Ledger de RETENCIÓN de originales de pedidos (fotos + busca2/Dobble).
//
// Principio (ORDEN 2): no se borra un original hasta haber verificado que el
// derivado existe y es válido, y aún así NO se borra en el acto sino tras una
// ventana de gracia (default 7 días). Así, si un pedido salió mal, hay una
// semana para darse cuenta en vez de cero segundos.
//
// Cuando un pedido se da por procesado OK, en vez de borrar sus objetos del
// bucket los ANOTAMOS acá con la marca de tiempo. El barrido del servicio
// (retentionSweep) borra del bucket lo que tenga más de `retentionDays`.
//
// Vive en userData/intake-retention.json (igual criterio que intake-config).
// Cada entrada: { id, kind: 'fotos'|'dobble', paths: [objectPath], numero,
//                 processedAt: epoch_ms }.

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FILENAME = 'intake-retention.json';

function getFilePath() {
  return path.join(app.getPath('userData'), FILENAME);
}

function load() {
  try {
    const raw = fs.readFileSync(getFilePath(), 'utf-8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function save(list) {
  const file = getFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(Array.isArray(list) ? list : [], null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

// Anota un pedido procesado para borrarlo del bucket más adelante. Si ya estaba
// (mismo id + kind), refresca sus paths sin duplicar.
function enqueue(entry) {
  if (!entry || !entry.id) return;
  const list = load();
  const idx = list.findIndex((e) => e.id === entry.id && e.kind === entry.kind);
  const row = {
    id: String(entry.id),
    kind: entry.kind === 'dobble' ? 'dobble' : 'fotos',
    paths: Array.isArray(entry.paths) ? entry.paths.filter(Boolean) : [],
    numero: entry.numero ?? null,
    processedAt: Number(entry.processedAt) || Date.now(),
  };
  if (idx >= 0) list[idx] = row; else list.push(row);
  save(list);
}

module.exports = { load, save, enqueue, getFilePath };
