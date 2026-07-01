// Evidencia del COMBO Dobble de 3 hojas (camino QR/tarjetas) contra plantilla
// SINTÉTICA (los PDF reales los aporta Mariano). Genera un PDF real de 3 hojas:
//   - Hoja 1 y 2: FONDO A (simula el fondo de Corel con QR) + grilla de cartas.
//   - Hoja 3:     FONDO B (otro fondo con QR) + cartas restantes + cartas fijas
//                 (instrucciones/portada) + caja (recuadro color + cuadrado frente imagen).
// Demuestra: posado multi-hoja en orden, FONDO POR HOJA (A≠B), roles de celda
// (card/fija/caja/frente-caja) y fondo de caja color+imagen. El corte/hendido/QR
// NO los genera la app (van en el fondo). Usa el renderer del motor (vendor).
//
// Correr: npm run evidence:dobble-combo   (o)  electron src/dobble/__tests__/gen-evidence-combo.cjs
// Salida: src/dobble/__fixtures__/evidence/dobble-combo-3hojas.pdf
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const FIX = path.join(__dirname, '..', '__fixtures__');
const OUT = path.join(FIX, 'evidence');
const PW = 210, PH = 297, SIDE = 65, DPIfake = 300;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const render = await import(pathToFileURL(path.join(__dirname, '..', 'vendor', 'render.js')).href);
  const recetaMod = await import(pathToFileURL(path.join(__dirname, '..', 'vendor', 'receta.js')).href);
  const receta = JSON.parse(fs.readFileSync(path.join(FIX, 'mazo-n3.receta.json'), 'utf-8'));
  const imgDataUrl = 'data:image/png;base64,' + fs.readFileSync(path.join(FIX, 'fondo-prueba.png')).toString('base64');

  const estilo = { ...recetaMod.estiloDeReceta(receta.carta), fondo: '#ffe2a8', fondoImagen: null };
  const bleedNorm = render.bleedNormal(SIDE, 0); // combo sin sangrado: la carta llena la celda

  const cardSvg = (i) => render.renderCartaSVG({
    placements: receta.cartas[i].placements, simbolos: receta.simbolos, estilo, bleedNorm, idPrefijo: `c${i}`,
  });

  // Celdas sintéticas (mm). Hoja A: 2×3 cartas. Hoja B: 1 carta + 2 fijas + caja + frente.
  const cardA = [];
  const xs = [35, 110], ys = [20, 95, 170];
  for (const y of ys) for (const x of xs) cardA.push({ x, y, w: SIDE, h: SIDE, role: 'card' });
  const pageA = { celdas: cardA };
  const pageB = {
    celdas: [
      { x: 35, y: 20, w: SIDE, h: SIDE, role: 'card' },
      { x: 110, y: 20, w: SIDE, h: SIDE, role: 'fija' },
      { x: 35, y: 95, w: SIDE, h: SIDE, role: 'fija' },
      { x: 20, y: 175, w: 170, h: 100, role: 'caja' },
      { x: 135, y: 185, w: 45, h: 45, role: 'frente-caja' },
    ],
  };
  const pages = [pageA, pageA, pageB];

  // QR falso + banda de color = "fondo" de cada hoja (en la vida real viene del PDF de Corel).
  const fakeQr = (x, y) =>
    `<g transform="translate(${x} ${y})"><rect width="16" height="16" fill="#fff" stroke="#111" stroke-width="0.4"/>`
    + [[2, 2], [6, 2], [10, 2], [2, 6], [10, 6], [2, 10], [6, 10], [10, 10], [12, 12], [4, 12]]
      .map(([a, b]) => `<rect x="${a}" y="${b}" width="3" height="3" fill="#111"/>`).join('')
    + `<text x="8" y="21" font-size="2.4" text-anchor="middle" fill="#111">QR</text></g>`;
  const bgLayer = (label, color) =>
    `<svg class="bg" viewBox="0 0 ${PW} ${PH}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="${PW}" height="${PH}" fill="${color}"/>`
    + `<rect x="0" y="0" width="${PW}" height="12" fill="${color === '#eaf2ff' ? '#c9ddff' : '#c9f0c9'}"/>`
    + `<text x="8" y="8.5" font-size="5" font-family="sans-serif" fill="#123">${label}</text>`
    + fakeQr(PW - 22, 3) + fakeQr(6, PH - 22) + fakeQr(PW - 22, PH - 22)
    + `</svg>`;

  const cellHtml = (cell, inner) =>
    `<div style="position:absolute;left:${cell.x}mm;top:${cell.y}mm;width:${cell.w}mm;height:${cell.h}mm">${inner}</div>`;

  // Reparto por rol, en orden a lo largo de las hojas (mismo criterio que buildDobbleComboSpec).
  let cardIdx = 0, fijaIdx = 0;
  const cajaColor = '#8b5a2b';
  const sheetHtml = (page, pIdx) => {
    const isB = pIdx === 2;
    let cells = '';
    for (const cell of page.celdas) {
      if (cell.role === 'card') {
        if (cardIdx < receta.cartas.length) {
          cells += cellHtml(cell, `<div class="svg">${cardSvg(cardIdx)}</div>`);
          cardIdx++;
        }
      } else if (cell.role === 'fija') {
        cells += cellHtml(cell, `<img class="fill" src="${imgDataUrl}"/><div class="tag">FIJA ${++fijaIdx}<br/>(instrucciones)</div>`);
      } else if (cell.role === 'caja') {
        cells += cellHtml(cell, `<div class="fill" style="background:${cajaColor}"></div><div class="tag">CAJA — fondo color (recuadro completo)</div>`);
      } else if (cell.role === 'frente-caja') {
        cells += cellHtml(cell, `<img class="fill" src="${imgDataUrl}"/><div class="tag">FRENTE (imagen cover)</div>`);
      }
    }
    const bg = isB ? bgLayer('FONDO B — HOJA CARTAS + CAJA', '#eafbea') : bgLayer('FONDO A — HOJA DE CARTAS', '#eaf2ff');
    return `<div class="sheet">${bg}${cells}</div>`;
  };

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 0; }
    html,body{margin:0;padding:0;background:#fff;}
    .sheet{position:relative;width:${PW}mm;height:${PH}mm;page-break-after:always;overflow:hidden;}
    .sheet:last-child{page-break-after:auto;}
    .bg{position:absolute;inset:0;width:100%;height:100%;}
    .svg{width:100%;height:100%;} .svg svg{width:100%;height:100%;display:block;}
    .fill{width:100%;height:100%;object-fit:cover;display:block;border-radius:1mm;}
    .tag{position:absolute;left:0;bottom:0;font:2mm/1.1 sans-serif;color:#0009;background:#fff8;padding:0.4mm;}
  </style></head><body>${pages.map(sheetHtml).join('')}</body></html>`;

  const htmlPath = path.join(OUT, 'dobble-combo-3hojas.html');
  fs.writeFileSync(htmlPath, html, 'utf-8');
  const win = new BrowserWindow({ show: false, width: 900, height: 1200 });
  await win.loadURL(pathToFileURL(htmlPath).href);
  await new Promise((r) => setTimeout(r, 400));
  const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  fs.writeFileSync(path.join(OUT, 'dobble-combo-3hojas.pdf'), pdf);
  fs.rmSync(htmlPath, { force: true });
  win.destroy();
  console.log(`✓ dobble-combo-3hojas.pdf (${(pdf.length / 1024).toFixed(0)} KB) · cartas posadas ${cardIdx}/${receta.cartas.length}`);
}

app.disableHardwareAcceleration();
app.whenReady().then(main).then(() => app.quit()).catch((e) => { console.error('FALLO:', e); app.exit(1); });
