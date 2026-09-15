// Worker de aplicación de LUT (worker_threads). Solo hace el bucle de píxeles, para no
// congelar el proceso principal en hojas grandes (SRA3). Recibe BGRA (buffer transferido),
// aplica la LUT in-place y lo devuelve. La decodificación/codificación PNG queda en el main
// (nativeImage no está disponible en un worker de node).
'use strict';
const { parentPort } = require('worker_threads');
const lutMod = require('./lut.cjs');

let lut = null;

parentPort.on('message', (msg) => {
  if (msg.type === 'init') {
    lut = lutMod.makeLut(msg.V, msg.size);
    parentPort.postMessage({ type: 'ready' });
    return;
  }
  if (msg.type === 'apply') {
    const bgra = new Uint8ClampedArray(msg.buffer);
    if (lut) lutMod.applyBgraInPlace(lut, bgra, msg.width, msg.height);
    parentPort.postMessage({ type: 'done', id: msg.id, buffer: bgra.buffer }, [bgra.buffer]);
  }
});
