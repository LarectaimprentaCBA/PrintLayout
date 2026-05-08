// Escribe electron/templates-config.json con el token para sync de plantillas.
// El token viene de la env var PRINTLAYOUT_TEMPLATES_TOKEN. Sin token, escribe
// un config vacio: el build queda funcional pero los pushes van a fallar
// con "Token no configurado".
//
// Este archivo esta gitignored. En el build queda dentro del asar y la app
// instalada lo lee al arrancar.

const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(__dirname, '..', 'electron', 'templates-config.json');
const token = process.env.PRINTLAYOUT_TEMPLATES_TOKEN || '';

const cfg = { token };
fs.writeFileSync(target, JSON.stringify(cfg, null, 2), 'utf-8');

if (token) {
  console.log(`[write-templates-config] token embebido (${token.length} chars) en ${path.basename(target)}`);
} else {
  console.warn(
    '[write-templates-config] PRINTLAYOUT_TEMPLATES_TOKEN no seteada — el build no podra subir plantillas. ' +
    'Para habilitar push, exporta la env var antes del build.',
  );
}
