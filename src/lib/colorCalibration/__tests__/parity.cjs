// Paridad del motor de calibración JS vs el kit C# de referencia (prueba-color-ricoh).
// Verificación 1 (bloqueante) de la orden de calibración de color.
//
// Corre bajo Electron (usa nativeImage para decodificar los escaneos):
//   npm run test:color-parity
//
// Depende de archivos que solo están en la PC de La Recta (los escaneos reales del kit
// y %LOCALAPPDATA%\KitColorRicoh). Si no están, SALTA con código 0 (no rompe el build).
// Bootstrap: si nos corrieron como Node (ELECTRON_RUN_AS_NODE), require('electron')
// devuelve la RUTA al binario. Nos re-lanzamos bajo Electron real con la variable limpia.
const _electron = require('electron');
if (typeof _electron === 'string') {
  const { spawnSync } = require('child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(_electron, [__filename], { stdio: 'inherit', env });
  process.exit(r.status == null ? 1 : r.status);
}

const { app, nativeImage } = _electron;
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const KIT = 'C:/Users/4/Desktop/Coordinacion La recta imprenta/prueba-color-ricoh';
const LOCAL = path.join(process.env.LOCALAPPDATA || '', 'KitColorRicoh');
const ENGINE = path.resolve(__dirname, '..', 'index.js');

function loadRgba(file) {
  const img = nativeImage.createFromPath(file);
  const { width, height } = img.getSize();
  if (!width || !height) throw new Error('no se pudo decodificar ' + file);
  const bgra = img.toBitmap(); // BGRA en Windows
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const j = i * 4;
    data[j] = bgra[j + 2]; data[j + 1] = bgra[j + 1]; data[j + 2] = bgra[j]; data[j + 3] = bgra[j + 3];
  }
  return { W: width, H: height, data };
}

function findScan(base) {
  const dir = path.join(KIT, 'escaneos');
  const exts = ['.jpg', '.jpeg', '.png', '.tif', '.tiff'];
  for (const f of fs.readdirSync(dir)) {
    let name = f;
    while (exts.includes(path.extname(name).toLowerCase())) name = path.basename(name, path.extname(name));
    if (name.trim().toLowerCase() === base) return path.join(dir, f);
  }
  throw new Error('falta escaneo ' + base);
}
const num = (re, t) => { const m = t.match(re); return m ? parseFloat(m[1].replace(',', '.')) : null; };

async function run() {
  if (!fs.existsSync(path.join(KIT, 'escaneos')) || !fs.existsSync(path.join(LOCAL, 'carta'))) {
    console.log('SALTADO: no están los archivos del kit en esta PC (' + KIT + ').');
    app.exit(0); return;
  }
  const E = await import(pathToFileURL(ENGINE).href);
  const results = [];
  let ok = true;
  const check = (name, pass, detail) => { results.push([pass, name, detail]); if (!pass) ok = false; };

  const mB = E.medir(loadRgba(findScan('carta-127')), 'escaneo .127', null);
  const mP = E.medir(loadRgba(findScan('carta-198')), 'escaneo .198', null);
  const t0 = Date.now();
  const res = E.calcular(mB, mP, E.LUT_SIZE);
  console.log('cálculo:', Date.now() - t0, 'ms');

  const refCube = E.Lut3.readCube(fs.readFileSync(path.join(KIT, 'resultado', 'correccion-198.cube'), 'utf8'));
  let maxNode = 0, sumNode = 0;
  for (let i = 0; i < res.lut.V.length; i++) {
    const d = Math.abs(res.lut.V[i] - refCube.V[i]);
    if (d > maxNode) maxNode = d; sumNode += d;
  }
  check('LUT max node <= 1.0', maxNode <= 1.0, 'max=' + maxNode.toFixed(4));
  check('LUT avg node <= 0.2', (sumNode / res.lut.V.length) <= 0.2, 'avg=' + (sumNode / res.lut.V.length).toFixed(4));

  const ref = fs.readFileSync(path.join(KIT, 'resultado', 'informe.txt'), 'utf8');
  const cmp = (label, re) => {
    const a = num(re, res.informe), b = num(re, ref);
    check('informe: ' + label, a != null && b != null && Math.abs(a - b) <= 0.1, 'js=' + a + ' ref=' + b);
  };
  cmp('lum buena', /\(buena\): ([\d,]+)/);
  cmp('lum palida', /\(pálida\): ([\d,]+)/);
  const jsP = res.informe.split('Previsto con la corrección:')[1] || '';
  const refP = ref.split('Previsto con la corrección:')[1] || '';
  check('informe: previsto promedio', Math.abs(num(/promedio ([\d,]+)/, jsP) - num(/promedio ([\d,]+)/, refP)) <= 0.1,
    'js=' + num(/promedio ([\d,]+)/, jsP) + ' ref=' + num(/promedio ([\d,]+)/, refP));
  check('informe: previsto máximo', Math.abs(num(/máximo ([\d,]+)/, jsP) - num(/máximo ([\d,]+)/, refP)) <= 0.1,
    'js=' + num(/máximo ([\d,]+)/, jsP) + ' ref=' + num(/máximo ([\d,]+)/, refP));

  try {
    const src = loadRgba(path.join(LOCAL, 'carta', 'carta-198.png'));
    const dstRef = loadRgba(path.join(LOCAL, 'carta', 'carta-198-corregida.png'));
    const outData = E.applyLutRgba(refCube, src.data, src.W, src.H);
    const yTop = Math.round((28 / 25.4) * 240), yBot = Math.round((283 / 25.4) * 240);
    let maxPix = 0;
    for (let y = yTop; y < yBot && y < src.H; y++)
      for (let x = 0; x < src.W; x++) {
        const j = (y * src.W + x) * 4;
        for (let c = 0; c < 3; c++) { const d = Math.abs(outData[j + c] - dstRef.data[j + c]); if (d > maxPix) maxPix = d; }
      }
    check('aplicar LUT: dif por píxel <= 1 (zona parches)', maxPix <= 1, 'max=' + maxPix);
  } catch (e) { check('aplicar LUT', false, 'ERROR ' + e.message); }

  console.log('=== PARIDAD ===');
  for (const [pass, name, detail] of results) console.log((pass ? 'OK  ' : 'FAIL') + '  ' + name + '   [' + detail + ']');
  console.log(ok ? '*** PARIDAD OK ***' : '*** PARIDAD FALLÓ ***');
  app.exit(ok ? 0 : 1);
}
app.whenReady().then(run).catch((e) => { console.error('ERROR:', e.stack || e.message); app.exit(2); });
