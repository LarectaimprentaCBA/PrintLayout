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

  console.log('\n6) Orden de las copias (intercalar / sin intercalar)');
  {
    const { ordenarCopias } = quickPrint;
    // Intercalado: el driver repite el documento entero.
    const a = ordenarCopias([1, 2], 99, true);
    check('intercalado manda las hojas una vez', a.paginas.join() === '1,2', a.paginas.join());
    check('y le pide 99 copias al driver', a.copias === 99, String(a.copias));

    // Sin intercalar: 99 veces la 1 y después 99 veces la 2, en UN envío.
    const b = ordenarCopias([1, 2], 99, false);
    check('sin intercalar manda 198 hojas', b.paginas.length === 198, String(b.paginas.length));
    check('y le pide 1 sola copia', b.copias === 1, String(b.copias));
    check('primero las 99 de la hoja 1', b.paginas.slice(0, 99).every((p) => p === 1));
    check('después las 99 de la hoja 2', b.paginas.slice(99).every((p) => p === 2));
    check('salen las mismas hojas que intercalado',
      b.paginas.filter((p) => p === 1).length === 99 && b.paginas.filter((p) => p === 2).length === 99);

    // Con una sola copia da igual: no hay nada que ordenar.
    const c = ordenarCopias([1, 2], 1, false);
    check('con 1 copia no cambia nada', c.paginas.join() === '1,2' && c.copias === 1);

    // Respeta la selección de páginas (rango / impares).
    const d = ordenarCopias([3, 5, 7], 2, false);
    check('respeta las páginas elegidas', d.paginas.join() === '3,3,5,5,7,7', d.paginas.join());
  }

  console.log('\n7) Fotos repetidas: no se arma ni se manda la misma hoja mil veces');
  {
    const { ordenarHojas } = quickPrint;
    const A = 'C:/t/a.png', B = 'C:/t/b.png';

    // 1 foto × 50 copias, 1 por hoja: UNA hoja y que la impresora la repita.
    const sola = ordenarHojas([A], new Array(50).fill(0), 1);
    check('una sola hoja distinta → se manda una vez', sola.paths.length === 1, String(sola.paths.length));
    check('y la impresora saca las 50', sola.copias === 50, String(sola.copias));

    // 2 fotos × 50 copias, 2 por hoja: 2 hojas distintas, 50 en total.
    const orden = [...new Array(25).fill(0), ...new Array(25).fill(1)];
    const dos = ordenarHojas([A, B], orden, 1);
    check('dos hojas distintas → salen las 50 hojas', dos.paths.length === 50, String(dos.paths.length));
    check('primero las 25 de la hoja A', dos.paths.slice(0, 25).every((p) => p === A));
    check('después las 25 de la hoja B', dos.paths.slice(25).every((p) => p === B));
    check('y no infla las copias', dos.copias === 1, String(dos.copias));
    check('las repetidas apuntan al MISMO archivo (una sola corrección de color)',
      new Set(dos.paths).size === 2, String(new Set(dos.paths).size));

    // Sin orden se comporta como siempre.
    const viejo = ordenarHojas([A, B], null, 3);
    check('sin orden manda las hojas tal cual', viejo.paths.join() === [A, B].join(), viejo.paths.join());
    check('y respeta las copias pedidas', viejo.copias === 3, String(viejo.copias));

    // Una hoja sola, una copia: nada raro.
    const simple = ordenarHojas([A], [0], 1);
    check('una hoja y una copia', simple.paths.length === 1 && simple.copias === 1);

    // Índices basura no rompen: se ignoran y quedan 2 hojas iguales → 2 copias.
    const sucio = ordenarHojas([A], [0, 7, 0], 1);
    check('ignora índices que no existen', sucio.paths.length === 1 && sucio.copias === 2,
      `${sucio.paths.length}/${sucio.copias}`);
  }

  for (const w of BrowserWindow.getAllWindows()) { try { w.destroy(); } catch (_) {} }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
  app.exit(fail ? 1 : 0);
});
