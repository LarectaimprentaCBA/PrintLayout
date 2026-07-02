// Evidencia E2E reproducible del posado Dobble (sin tocar diálogos nativos).
// Posa el mazo fixture (n=3, 13 cartas, engine 0.4.0) sobre una plantilla redonda
// y genera DOS PDF reales (vía Electron printToPDF) de la hoja imposicionada:
//   - dobble-n3-color.pdf   (fondo de carta = color sólido)
//   - dobble-n3-imagen.pdf  (fondo de carta = imagen, recortada al círculo + sangrado)
// Cada PDF muestra la grilla, los círculos de corte (punteado) y las marcas L de
// registro, paginado (13 cartas → varias hojas A4). Usa el MISMO renderer del motor
// (vendor) y la MISMA geometría que buildDobbleJob.
//
// Correr:  npm run evidence:dobble    (o)   electron src/dobble/__tests__/gen-evidence.cjs
// Salida:  src/dobble/__fixtures__/evidence/*.pdf
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const FIX = path.join(__dirname, '..', '__fixtures__');
const OUT = path.join(FIX, 'evidence');

const PAPER_W = 210, PAPER_H = 297, SIDE = 71, CUT_MARGIN = 3, MARK_MARGIN = 10;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const render = await import(pathToFileURL(path.join(__dirname, '..', 'vendor', 'render.js')).href);
  const recetaMod = await import(pathToFileURL(path.join(__dirname, '..', 'vendor', 'receta.js')).href);
  const gridMod = await import(pathToFileURL(path.join(__dirname, '..', '..', 'lib', 'grid.js')).href);
  const bjob = await import(pathToFileURL(path.join(__dirname, '..', 'buildDobbleJob.js')).href);

  const receta = JSON.parse(fs.readFileSync(path.join(FIX, 'mazo-n3.receta.json'), 'utf-8'));
  const fondoDataUrl = 'data:image/png;base64,' + fs.readFileSync(path.join(FIX, 'fondo-prueba.png')).toString('base64');

  // Plantilla redonda (como la que crea la grilla rápida en modo círculo).
  const margin = MARK_MARGIN + 2;
  const grid = gridMod.computeBestGrid(
    { paperW: PAPER_W, paperH: PAPER_H, cellW: SIDE, cellH: SIDE, marginX: margin, marginY: margin, spacingX: 3, spacingY: 3 },
    { rotateMode: 'direct' },
  );
  const celdas = grid.cells.map((c, i) => ({ id: i, x: c.x, y: c.y, w: c.w, h: c.h }));
  const template = {
    name: 'Redonda evidencia', pageWidthMm: PAPER_W, pageHeightMm: PAPER_H,
    celdas, cortes: gridMod.generateCuts(celdas, { cutShape: 'circle', cutMarginMm: CUT_MARGIN }),
    cutMarginMm: CUT_MARGIN, markMarginMm: MARK_MARGIN, cutShape: 'circle',
  };
  const geo = bjob.dobbleGeometryFromTemplate(template);
  const bleedNorm = render.bleedNormal(geo.diam, geo.bleed);
  const cpp = celdas.length;

  const baseEstilo = recetaMod.estiloDeReceta(receta.carta);

  const cardSvg = (i, fondo, fondoImagen) =>
    render.renderCartaSVG({
      placements: receta.cartas[i].placements,
      simbolos: receta.simbolos,
      estilo: { ...baseEstilo, fondo, fondoImagen: fondoImagen || null },
      bleedNorm,
      idPrefijo: `e${fondoImagen ? 'i' : 'c'}${i}`,
    });

  const lMark = (x, y, dx, dy) =>
    `<path d="M ${x + dx * 5} ${y} L ${x} ${y} L ${x} ${y + dy * 5}" fill="none" stroke="#111" stroke-width="0.3"/>`;

  const sheetHtml = (cards) => {
    const m = MARK_MARGIN;
    const cardDivs = cards.map(({ i, cell, svg }) =>
      `<div class="card" style="left:${cell.x}mm;top:${cell.y}mm;width:${cell.w}mm;height:${cell.h}mm">${svg}</div>`
        + `<div class="lbl" style="left:${cell.x}mm;top:${cell.y}mm">${i + 1}</div>`,
    ).join('');
    const cuts = cards.map(({ cell }) => {
      const cx = cell.x + cell.w / 2, cy = cell.y + cell.h / 2, r = geo.diam / 2;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e0115f" stroke-width="0.25" stroke-dasharray="1.2 1"/>`;
    }).join('');
    const marks = [lMark(m, m, 1, 1), lMark(PAPER_W - m, m, -1, 1), lMark(m, PAPER_H - m, 1, -1), lMark(PAPER_W - m, PAPER_H - m, -1, -1)].join('');
    return `<div class="sheet">${cardDivs}<svg class="ov" viewBox="0 0 ${PAPER_W} ${PAPER_H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${cuts}${marks}</svg></div>`;
  };

  const buildDoc = (fondo, fondoImagen) => {
    const pages = Math.ceil(receta.cartas.length / cpp);
    let sheets = '';
    for (let p = 0; p < pages; p++) {
      const cards = [];
      for (let k = 0; k < cpp; k++) {
        const i = p * cpp + k;
        if (i >= receta.cartas.length) break;
        cards.push({ i, cell: celdas[k], svg: cardSvg(i, fondo, fondoImagen) });
      }
      sheets += sheetHtml(cards);
    }
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 0; }
      html,body{margin:0;padding:0;background:#fff;}
      .sheet{position:relative;width:${PAPER_W}mm;height:${PAPER_H}mm;page-break-after:always;overflow:hidden;background:#fff;}
      .sheet:last-child{page-break-after:auto;}
      .card{position:absolute;}
      .card svg{width:100%;height:100%;display:block;}
      .lbl{position:absolute;font:2.6mm/1 sans-serif;color:#0008;transform:translate(0.6mm,0.4mm);}
      .ov{position:absolute;inset:0;}
    </style></head><body>${sheets}</body></html>`;
  };

  const variants = [
    { name: 'dobble-n3-color', fondo: '#ffe2a8', fondoImagen: null },
    { name: 'dobble-n3-imagen', fondo: '#101820', fondoImagen: fondoDataUrl },
  ];

  const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { offscreen: false } });
  const loadHtml = (htmlPath) => new Promise((resolve, reject) => {
    const wc = win.webContents;
    const onOk = () => { cleanup(); resolve(); };
    const onFail = (_e, code, desc) => { cleanup(); reject(new Error(`did-fail-load ${code} ${desc}`)); };
    const cleanup = () => { wc.off('did-finish-load', onOk); wc.off('did-fail-load', onFail); };
    wc.once('did-finish-load', onOk);
    wc.once('did-fail-load', onFail);
    win.loadURL(pathToFileURL(htmlPath).href).catch(reject);
  });

  for (const v of variants) {
    const htmlPath = path.join(OUT, v.name + '.html');
    fs.writeFileSync(htmlPath, buildDoc(v.fondo, v.fondoImagen), 'utf-8');
    await loadHtml(htmlPath);
    await new Promise((r) => setTimeout(r, 400)); // decode de las imágenes embebidas
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    fs.writeFileSync(path.join(OUT, v.name + '.pdf'), pdf);
    fs.rmSync(htmlPath, { force: true }); // el HTML es intermedio; dejamos sólo el PDF
    console.log(`✓ ${v.name}.pdf  (${(pdf.length / 1024).toFixed(0)} KB)`);
  }
  win.destroy();

  console.log(`Hojas/PDF: ${Math.ceil(receta.cartas.length / cpp)} · cartas ${receta.cartas.length} · ${cpp}/hoja · carta ⌀ ${geo.diam}mm sangrado ${geo.bleed}mm`);
}

app.disableHardwareAcceleration();
app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((err) => { console.error('EVIDENCIA FALLO:', err); app.exit(1); });
