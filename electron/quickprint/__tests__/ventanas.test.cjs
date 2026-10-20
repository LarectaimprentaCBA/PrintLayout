// Una ventana POR PEDIDO.
//
// El problema: con una sola ventana, mandar a imprimir un segundo archivo
// mientras el primero seguía abierto traía la ventana al frente mostrando el
// archivo VIEJO (el nuevo quedaba en una fila detrás). Ahora cada pedido abre
// su propia ventana, con su propio archivo y su propio título.
//
// Corre con: npm run test:quickprint-ventanas   (necesita electron: abre ventanas)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, nativeImage, ipcMain } = require('electron');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-qp-'));
app.setPath('userData', tmp);

const quickPrint = require('../service.cjs');

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Dos PDF de mentira (al módulo solo le importa que el archivo exista).
const pdfA = path.join(tmp, 'factura.pdf');
const pdfB = path.join(tmp, 'etiquetas.pdf');
fs.writeFileSync(pdfA, '%PDF-1.4\n');
fs.writeFileSync(pdfB, '%PDF-1.4\n');
const foto = path.join(tmp, 'nena.jpg');
fs.writeFileSync(foto, 'x');

app.whenReady().then(async () => {
  // Los maneja main.cjs, que acá no corre: los stubeamos para no llenar la
  // salida de "No handler registered".
  ipcMain.handle('print:list-printers', () => ({ ok: true, printers: [] }));
  ipcMain.handle('color:resolve-active', () => ({ ok: true, active: null }));

  quickPrint.init({
    resolvePrintHelper: () => null,
    devmodeFilePath: () => null,
    ghostscriptBin: () => null,
    GHOSTSCRIPT_DIR: '',
    appendDebugLog: () => {},
    appIconImage: () => nativeImage.createEmpty(),
    isDev: false,
  });

  // El coalesce junta lo que llega en ~250 ms: por eso esperamos entre pedidos.
  console.log('\n1) Primer pedido: una ventana');
  quickPrint.enqueue([pdfA]);
  await esperar(1500);
  let abiertas = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  check('se abrió 1 ventana', abiertas.length === 1, String(abiertas.length));
  check('el título dice el archivo', abiertas[0] && abiertas[0].getTitle() === 'Imprimir — factura.pdf',
    abiertas[0] && abiertas[0].getTitle());

  console.log('\n2) Segundo pedido con la primera abierta: OTRA ventana');
  quickPrint.enqueue([pdfB]);
  await esperar(1500);
  abiertas = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  check('ahora hay 2 ventanas', abiertas.length === 2, String(abiertas.length));
  const titulos = abiertas.map((w) => w.getTitle()).sort();
  check('cada una muestra SU archivo',
    titulos.join(' | ') === 'Imprimir — etiquetas.pdf | Imprimir — factura.pdf', titulos.join(' | '));
  check('no quedan una exactamente encima de la otra',
    abiertas[0].getBounds().x !== abiertas[1].getBounds().x
    || abiertas[0].getBounds().y !== abiertas[1].getBounds().y,
    JSON.stringify(abiertas.map((w) => w.getBounds())));

  console.log('\n3) Cada ventana recibe SUS archivos, no los de la otra');
  // get-files se resuelve por quién pregunta: lo comprobamos desde el main,
  // leyendo lo que el módulo tiene guardado para cada ventana.
  const pedir = (w) => w.webContents.executeJavaScript('window.printlayout.quickprint.getFiles()');
  const r0 = await pedir(abiertas[0]);
  const r1 = await pedir(abiertas[1]);
  const nombres = (r) => (r.pdfs || []).map((f) => f.name).join(',');
  check('la ventana 1 trae solo lo suyo', nombres(r0) === 'factura.pdf' || nombres(r0) === 'etiquetas.pdf', nombres(r0));
  check('la ventana 2 trae solo lo suyo', nombres(r1) === 'factura.pdf' || nombres(r1) === 'etiquetas.pdf', nombres(r1));
  check('y no traen lo mismo', nombres(r0) !== nombres(r1), `${nombres(r0)} / ${nombres(r1)}`);
  check('ninguna trae los dos', (r0.pdfs || []).length === 1 && (r1.pdfs || []).length === 1,
    `${(r0.pdfs || []).length} / ${(r1.pdfs || []).length}`);

  console.log('\n4) Cerrar una no cierra la otra');
  abiertas[0].close();
  await esperar(600);
  const quedan = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  check('queda 1 abierta', quedan.length === 1, String(quedan.length));

  console.log('\n5) Varios archivos en un mismo pedido = UNA ventana con la fila');
  quickPrint.enqueue([pdfA, pdfB, foto]);
  await esperar(1500);
  const trasLote = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  check('sumó una sola ventana', trasLote.length === 2, String(trasLote.length));
  const nueva = trasLote.find((w) => w.getTitle().includes('+') || w.getTitle().includes('PDF'));
  check('el título resume el lote', !!nueva && /2 PDF/.test(nueva.getTitle()), nueva && nueva.getTitle());

  for (const w of BrowserWindow.getAllWindows()) { try { w.destroy(); } catch (_) {} }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
  app.exit(fail ? 1 : 0);
});
