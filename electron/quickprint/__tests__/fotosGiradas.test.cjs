// Las fotos NO se deforman.
//
// El problema: los JPG grandes de iPhone sacados en vertical vienen "acostados"
// con una etiqueta (EXIF) que dice "girame". Al achicarlos a 3000 px con
// createImageBitmap({resize…}) el tamaño se aplicaba ANTES del giro y la foto
// salía estirada: un círculo quedaba ovalado. Las fotos chicas, las HEIC y las
// que no llevan giro salían bien, por eso pasaba "con algunas".
//
// Acá se arman fotos con un aro perfectamente redondo (grandes y chicas, con
// cada giro posible), se abren en la ventana de impresión de verdad y se mide
// el aro en la hoja: tiene que seguir siendo redondo.
//
// Corre con: npm run test:quickprint-fotos-giradas   (necesita electron y dist/)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, nativeImage, ipcMain } = require('electron');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-qp-giro-'));
app.setPath('userData', tmp);

const quickPrint = require('../service.cjs');

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Foto W×H: fondo gris, un aro negro redondo al centro y un cuadrado rojo en la
// esquina de arriba a la izquierda (para ver hacia dónde quedó girada).
function fotoJpeg(W, H) {
  const buf = Buffer.alloc(W * H * 4);
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.4, g = R * 0.08;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const d = Math.hypot(x - cx, y - cy);
      let b = 225, gr = 225, r = 225;
      if (Math.abs(d - R) < g) { b = 0; gr = 0; r = 0; }
      if (x < W * 0.12 && y < W * 0.12) { b = 30; gr = 30; r = 230; }
      buf[i] = b; buf[i + 1] = gr; buf[i + 2] = r; buf[i + 3] = 255; // BGRA
    }
  }
  return nativeImage.createFromBitmap(buf, { width: W, height: H }).toJPEG(88);
}
// Le agrega al JPEG la etiqueta EXIF de orientación (1..8).
function conGiro(jpeg, orient) {
  const tiff = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orient, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const cuerpo = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const cab = Buffer.from([0xff, 0xe1, (cuerpo.length + 2) >> 8, (cuerpo.length + 2) & 0xff]);
  return Buffer.concat([jpeg.subarray(0, 2), cab, cuerpo, jpeg.subarray(2)]);
}

// Mide el ancho y el alto del aro negro en la hoja dibujada (una foto por hoja).
const MEDIR = `(() => {
  const c = document.querySelector('canvas');
  if (!c || !c.width) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const medir = (x0, x1) => {
    let a = 1e9, b = -1, t = 1e9, u = -1;
    for (let y = 0; y < c.height; y++) for (let x = x0; x < x1; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i] < 70 && d[i + 1] < 70 && d[i + 2] < 70) { if (x < a) a = x; if (x > b) b = x; if (y < t) t = y; if (y > u) u = y; }
    }
    return b < 0 ? null : { ancho: b - a + 1, alto: u - t + 1 };
  };
  return [medir(0, c.width)];
})()`;

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  ipcMain.handle('print:list-printers', () => ({ ok: true, printers: [{ name: 'Prueba', displayName: 'Prueba', isDefault: true }] }));
  ipcMain.handle('color:resolve-active', () => ({ ok: true, active: null }));
  ipcMain.handle('color:list', () => ({ ok: true, calibrations: [] }));

  quickPrint.init({
    resolvePrintHelper: () => null,
    devmodeFilePath: () => null,
    ghostscriptBin: () => null,
    GHOSTSCRIPT_DIR: '',
    appendDebugLog: () => {},
    appIconImage: () => nativeImage.createEmpty(),
    isDev: false,
  });
  // Sin impresora de verdad: papel de foto 10×15, así entra UNA foto por hoja
  // y el aro se mide sin confundirlo con el de al lado.
  ipcMain.removeHandler('quickprint:page-info');
  ipcMain.handle('quickprint:page-info', () => ({
    ok: true, paperWmm: 102, paperHmm: 152, printWmm: 100, printHmm: 150,
    marginLmm: 1, marginTmm: 1, orientation: 'portrait', duplex: false,
  }));

  const grande = fotoJpeg(4032, 3024); // como sale del iPhone
  const chica = fotoJpeg(1600, 1200);  // no llega a achicarse
  const casos = [];
  const poner = (nombre, bytes) => { const f = path.join(tmp, nombre); fs.writeFileSync(f, bytes); casos.push(nombre); return f; };
  const archivos = [];
  // El nombre arranca con el número para que queden en este orden (la ventana ordena por nombre).
  let n = 0;
  for (const [tam, bytes] of [['grande', grande], ['chica', chica]]) {
    archivos.push(poner(`${String(++n).padStart(2, '0')}_${tam}_sin_giro.jpg`, bytes));
    for (const o of [3, 6, 8, 5, 7]) archivos.push(poner(`${String(++n).padStart(2, '0')}_${tam}_giro${o}.jpg`, conGiro(bytes, o)));
  }

  quickPrint.enqueue(archivos);
  let w = null;
  for (let i = 0; i < 40 && !w; i++) { w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed()); await esperar(250); }
  const js = (c) => w.webContents.executeJavaScript(c, true);
  let texto = '';
  for (let i = 0; i < 240; i++) {
    texto = await js('document.body.innerText.slice(0, 300)');
    if (/\d+ fotos? /.test(texto) && !/Preparando/.test(texto)) break;
    await esperar(500);
  }
  check(`la ventana preparó las ${archivos.length} fotos`, new RegExp(`^${archivos.length} fotos`, 'm').test(texto), texto.slice(0, 80));

  for (const enmarcar of [false, true]) {
    console.log(enmarcar ? '\nCon "Enmarcar la imagen" (recorta para llenar)' : '\nSin enmarcar (la foto entra entera)');
    await js(`(() => { const c = document.querySelector('input[type=checkbox]'); if (c && c.checked !== ${enmarcar}) c.click(); })()`);
    // volver a la primera hoja
    for (let i = 0; i < 20; i++) {
      const fue = await js('(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "◀"); if (!b || b.disabled) return false; b.click(); return true; })()');
      if (!fue) break;
      await esperar(150);
    }
    await esperar(600);
    let k = 0;
    for (let hoja = 0; hoja < 40 && k < casos.length; hoja++) {
      const m = await js(MEDIR);
      for (const lado of (m || [])) {
        if (k >= casos.length) break;
        const nombre = casos[k++];
        if (!lado) { check(`${nombre}: se dibujó`, false, 'no se encontró el aro'); continue; }
        const dif = Math.abs(lado.ancho - lado.alto) / Math.max(lado.ancho, lado.alto);
        check(`${nombre}: el aro sigue redondo`, dif < 0.03, `${lado.ancho} × ${lado.alto} px`);
      }
      const sigue = await js('(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "▶"); if (!b || b.disabled) return false; b.click(); return true; })()');
      if (!sigue) break;
      await esperar(500);
    }
    check('se midieron todas las fotos', k === casos.length, `${k} de ${casos.length}`);
  }

  for (const x of BrowserWindow.getAllWindows()) { try { x.destroy(); } catch (_) {} }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
  app.exit(fail ? 1 : 0);
});
