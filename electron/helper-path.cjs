// Dónde está el PrintHelper (el programa que manda las hojas a la impresora) y
// qué hacer si no está.
//
// Puede FALTAR. En la PC del taller, Avast borró resources\PrintHelper.exe y
// además BLOQUEA que se vuelva a escribir ahí. Comprobado que es por NOMBRE y
// no por contenido: los mismos bytes copiados como "plhelper.bin" entran sin
// problema y el programa corre igual (Windows ejecuta un .bin si adentro hay un
// ejecutable válido). Por eso llevamos un repuesto adentro del paquete
// (electron/bin/plhelper.bin, lo deja scripts/copy-helper.cjs en cada build) y,
// si falta, lo dejamos en userData con ese otro nombre.
//
// Esto es un parche para que la impresora siga andando. El arreglo de fondo
// sigue siendo agregar la exclusión en el antivirus.
//
// Vive aparte de main.cjs para poder probarlo: acá adentro no hay nada de
// Electron, solo fs y path.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// El usuario no tiene por qué saber qué es "PrintHelper.exe", pero sí qué hacer.
const MSG_SIN_HELPER = 'Falta un archivo de PrintLayout (PrintHelper.exe), que es el que manda '
  + 'las hojas a la impresora. Casi siempre lo borra el antivirus: agregá una exclusión para '
  + 'la carpeta de PrintLayout y volvé a instalarlo.';

/**
 * Busca el PrintHelper y, si no está en ningún lado, lo repone desde la copia
 * que viaja adentro del paquete.
 *
 * @param {object} o
 * @param {string} o.appDir       carpeta electron/ (al lado está bin/, y ../helper/ en dev)
 * @param {string} o.resourcesPath carpeta resources/ del instalado ('' en dev)
 * @param {string} o.userDataDir  carpeta de datos del usuario
 * @param {Function} [o.log]
 * @returns {string|null} ruta del ejecutable, o null si tampoco se pudo reponer
 */
function buscarPrintHelper({ appDir, resourcesPath, userDataDir, log = () => {} }) {
  const candidatos = [
    path.join(appDir, '..', 'helper', 'PrintHelper.exe'),   // dev / repo
    resourcesPath ? path.join(resourcesPath, 'PrintHelper.exe') : null, // instalado
    path.join(userDataDir, 'bin', 'plhelper.bin'),          // repuesto ya guardado
  ];
  for (const c of candidatos) {
    if (c && fs.existsSync(c)) return c;
  }
  try {
    const repuesto = path.join(appDir, 'bin', 'plhelper.bin');
    if (!fs.existsSync(repuesto)) {
      log('[helper] falta PrintHelper y no hay repuesto adentro del paquete');
      return null;
    }
    const dir = path.join(userDataDir, 'bin');
    fs.mkdirSync(dir, { recursive: true });
    const dst = path.join(dir, 'plhelper.bin');
    fs.copyFileSync(repuesto, dst);
    log(`[helper] faltaba PrintHelper.exe (¿antivirus?): repuesto en ${dst}`);
    return dst;
  } catch (err) {
    log(`[helper] no se pudo reponer PrintHelper: ${err.message}`);
    return null;
  }
}

module.exports = { buscarPrintHelper, MSG_SIN_HELPER };
