// Guardado SILENCIOSO de un PDF a un path conocido (sin diálogo "Guardar como").
// Lo usa el exportador Dobble automático: el PDF final se deja directo en la
// carpeta configurada, nombrado por el presupuesto. Separado en un módulo puro
// (sin electron) para poder testearlo en node.

const fs = require('node:fs');
const path = require('node:path');

// Escribe `bytes` (Uint8Array/Buffer/ArrayBuffer) en `filePath`, creando la
// carpeta destino si no existe. Devuelve el path escrito. Lanza si falta el path.
function writePdfSilent(filePath, bytes) {
  if (!filePath || typeof filePath !== 'string') throw new Error('path vacío');
  const buf = Buffer.from(bytes);
  // El derivado tiene que ser un PDF de verdad: si los bytes no arrancan con
  // %PDF- algo salió mal al generarlo → no lo guardamos como entregado.
  if (buf.length < 5 || buf.slice(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('los bytes a guardar no son un PDF válido (falta %PDF-)');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
  // Verificar que quedó COMPLETO en disco: una escritura truncada (disco lleno)
  // dejaría un PDF corrupto que se daría por entregado y borraría el original.
  const st = fs.statSync(filePath);
  if (st.size !== buf.length) {
    throw new Error(`PDF guardado incompleto: ${st.size} de ${buf.length} bytes`);
  }
  return filePath;
}

// Nombre de archivo seguro para Windows a partir del presupuesto + nombre del
// mazo: "PR-<numero> - <nombre>.pdf". Sólo saca los caracteres inválidos de
// Windows; conserva espacios y guiones del formato pedido.
const INVALID_WIN = /[<>:"/\\|?*]/g;
function dobblePdfFileName(numeroPresupuesto, nombreMazo) {
  const clean = (s, fallback) => {
    const t = String(s == null ? '' : s).replace(INVALID_WIN, '_').replace(/\s+/g, ' ').trim();
    return t || fallback;
  };
  const pr = clean(numeroPresupuesto, 'sin-presupuesto');
  const nombre = clean(nombreMazo, 'Mazo Dobble');
  return `PR-${pr} - ${nombre}.pdf`.slice(0, 180);
}

// Nombre de archivo del PDF de un pedido de rótulos: "PR-<numero> - <nombre>.pdf"
// (mismo formato que Dobble; sólo cambia el fallback del nombre).
function rotuloPdfFileName(numeroPresupuesto, nombre) {
  const clean = (s, fallback) => {
    const t = String(s == null ? '' : s).replace(INVALID_WIN, '_').replace(/\s+/g, ' ').trim();
    return t || fallback;
  };
  const pr = clean(numeroPresupuesto, 'sin-presupuesto');
  const nom = clean(nombre, 'Rotulos');
  return `PR-${pr} - ${nom}.pdf`.slice(0, 180);
}

module.exports = { writePdfSilent, dobblePdfFileName, rotuloPdfFileName };
