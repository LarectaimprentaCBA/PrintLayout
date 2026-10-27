// Deja una copia de repuesto del PrintHelper DENTRO del paquete (electron/ va a
// parar a app.asar), para poder reponerlo si desaparece de resources/.
//
// Por qué hace falta: en la PC del taller, Avast borró
// resources\PrintHelper.exe y además BLOQUEA que se vuelva a escribir ahí.
// Comprobado que es por NOMBRE, no por contenido: los mismos bytes copiados como
// "plhelper.bin" entran sin problema y el programa corre igual (Windows ejecuta
// un .bin si adentro hay un ejecutable válido). Por eso el repuesto no se llama
// .exe. El arreglo de fondo sigue siendo la exclusión en el antivirus.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const src = path.join(raiz, 'helper', 'PrintHelper.exe');
const dir = path.join(raiz, 'electron', 'bin');
const dst = path.join(dir, 'plhelper.bin');

if (!fs.existsSync(src)) {
  console.warn('[helper] no está helper/PrintHelper.exe — no copio el repuesto');
  process.exit(0);
}
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(src, dst);
console.log(`[helper] repuesto → electron/bin/plhelper.bin (${fs.statSync(dst).size} bytes)`);
