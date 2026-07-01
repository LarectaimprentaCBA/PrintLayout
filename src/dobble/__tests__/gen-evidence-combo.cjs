// Evidencia del COMBO Dobble de 3 hojas — DOBLE FAZ (camino QR/tarjetas) contra
// plantilla SINTÉTICA (los PDF reales los aporta Mariano). Genera un PDF de 6
// hojas que replica la salida de buildDoubleSidedPdf: 3 frentes + 3 dorsos.
//   - Frente 1 y 2: FONDO A (simula Corel con QR) + grilla de cartas.
//   - Frente 3:     FONDO B (otro fondo con QR) + carta(s) restantes + instrucciones
//                   HORNEADAS en el fondo + caja EN BLANCO (la corta/pliega el plotter).
//   - Dorso 1-3:    dorso compartido (renderDorsoSVG) en las celdas card, espejado
//                   en X, sin fondo. Caja/instrucciones = solo frente.
// Demuestra: posado multi-hoja en orden, FONDO POR HOJA (A≠B), doble faz (frente+
// dorso por hoja), caja en blanco (MVP). Usa el renderer del motor (vendor).
//
// Correr: npm run evidence:dobble-combo   (o)  electron src/dobble/__tests__/gen-evidence-combo.cjs
// Salida: src/dobble/__fixtures__/evidence/dobble-combo-3hojas.pdf
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const FIX = path.join(__dirname, '..', '__fixtures__');
const OUT = path.join(FIX, 'evidence');
const PW = 210, PH = 297, SIDE = 65;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const render = await import(pathToFileURL(path.join(__dirname, '..', 'vendor', 'render.js')).href);
  const recetaMod = await import(pathToFileURL(path.join(__dirname, '..', 'vendor', 'receta.js')).href);
  const receta = JSON.parse(fs.readFileSync(path.join(FIX, 'mazo-n3.receta.json'), 'utf-8'));

  const estilo = { ...recetaMod.estiloDeReceta(receta.carta), fondo: '#ffe2a8', fondoImagen: null };
  const bleedNorm = render.bleedNormal(SIDE, 0);
  const cardSvg = (i) => render.renderCartaSVG({
    placements: receta.cartas[i].placements, simbolos: receta.simbolos, estilo, bleedNorm, idPrefijo: `c${i}`,
  });
  const dorsoSvg = render.renderDorsoSVG(
    { ...(receta.dorso || {}), fondo: receta.dorso?.fondo ?? '#2f6df6' },
    recetaMod.estiloDeReceta(receta.carta), { bleedNorm },
  );

  // Celdas (mm). Hoja A: 2×3 cartas. Hoja B: 1 carta + caja (en blanco).
  const cardA = [];
  const xs = [35, 110], ys = [20, 95, 170];
  for (const y of ys) for (const x of xs) cardA.push({ x, y, w: SIDE, h: SIDE, role: 'card' });
  const pageB = [
    { x: 35, y: 20, w: SIDE, h: SIDE, role: 'card' },
    { x: 20, y: 175, w: 170, h: 100, role: 'caja' },
  ];
  const pages = [cardA, cardA, pageB];

  const fakeQr = (x, y) =>
    `<g transform="translate(${x} ${y})"><rect width="16" height="16" fill="#fff" stroke="#111" stroke-width="0.4"/>`
    + [[2, 2], [6, 2], [10, 2], [2, 6], [10, 6], [2, 10], [6, 10], [10, 10], [12, 12], [4, 12]]
      .map(([a, b]) => `<rect x="${a}" y="${b}" width="3" height="3" fill="#111"/>`).join('')
    + `<text x="8" y="21" font-size="2.4" text-anchor="middle" fill="#111">QR</text></g>`;
  const instrArt =
    `<g transform="translate(${PW / 2} 108)"><rect x="-92" y="-8" width="184" height="46" rx="2" fill="#ffffffcc" stroke="#111" stroke-width="0.3"/>`
    + `<text x="0" y="0" font-size="4.5" text-anchor="middle" font-family="sans-serif" fill="#111">INSTRUCCIONES (horneadas en el fondo del Corel — no es celda)</text>`
    + `<text x="0" y="9" font-size="2.8" text-anchor="middle" fill="#444">Cada 2 cartas comparten 1 símbolo. Fijas como el QR → arte del fondo.</text></g>`;
  const bgLayer = (label, color, extra = '') =>
    `<svg class="bg" viewBox="0 0 ${PW} ${PH}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="${PW}" height="${PH}" fill="${color}"/><rect width="${PW}" height="12" fill="${color === '#eaf2ff' ? '#c9ddff' : '#c9f0c9'}"/>`
    + `<text x="8" y="8.5" font-size="5" font-family="sans-serif" fill="#123">${label}</text>`
    + fakeQr(PW - 22, 3) + fakeQr(6, PH - 22) + fakeQr(PW - 22, PH - 22) + extra + `</svg>`;

  const cellDiv = (cell, inner) =>
    `<div style="position:absolute;left:${cell.x}mm;top:${cell.y}mm;width:${cell.w}mm;height:${cell.h}mm">${inner}</div>`;

  // Reparto de cartas por rol, en orden a lo largo de las hojas (frente).
  let cardIdx = 0;
  const nCards = receta.cartas.length;
  const frontSheet = (page, pIdx) => {
    let cells = '';
    for (const cell of page) {
      if (cell.role === 'card') {
        if (cardIdx < nCards) { cells += cellDiv(cell, `<div class="svg">${cardSvg(cardIdx)}</div>`); cardIdx++; }
      } else if (cell.role === 'caja') {
        cells += cellDiv(cell, `<div class="blank">CAJA — en blanco<br/>(la corta/pliega el plotter por QR)</div>`);
      }
    }
    const bg = pIdx === 2 ? bgLayer('FRENTE 3 · FONDO B — CARTAS + CAJA', '#eafbea', instrArt)
      : bgLayer(`FRENTE ${pIdx + 1} · FONDO A — HOJA DE CARTAS`, '#eaf2ff');
    return `<div class="sheet">${bg}${cells}</div>`;
  };

  // Dorso: mismo dorso compartido en cada celda card, espejado en X, sin fondo.
  let backCount = 0;
  const remainingBacks = () => nCards - backCount;
  const backSheet = (page, pIdx) => {
    let cells = '';
    for (const cell of page) {
      if (cell.role === 'card' && remainingBacks() > 0) {
        const bx = PW - cell.x - cell.w; // espejo en X (al girar la hoja cae detrás)
        cells += cellDiv({ ...cell, x: bx }, `<div class="svg">${dorsoSvg}</div>`);
        backCount++;
      }
    }
    return `<div class="sheet"><svg class="bg" viewBox="0 0 ${PW} ${PH}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><rect width="${PW}" height="${PH}" fill="#fff"/><text x="8" y="8.5" font-size="5" font-family="sans-serif" fill="#999">DORSO hoja ${pIdx + 1} (sin fondo · espejado en X)</text></svg>${cells}</div>`;
  };

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 0; }
    html,body{margin:0;padding:0;background:#fff;}
    .sheet{position:relative;width:${PW}mm;height:${PH}mm;page-break-after:always;overflow:hidden;}
    .sheet:last-child{page-break-after:auto;}
    .bg{position:absolute;inset:0;width:100%;height:100%;}
    .svg{width:100%;height:100%;} .svg svg{width:100%;height:100%;display:block;}
    .blank{width:100%;height:100%;border:0.4mm dashed #999;border-radius:1mm;display:flex;align-items:center;justify-content:center;text-align:center;font:2.4mm/1.2 sans-serif;color:#777;}
  </style></head><body>`
    + pages.map(frontSheet).join('') + pages.map(backSheet).join('')
    + `</body></html>`;

  const htmlPath = path.join(OUT, 'dobble-combo-3hojas.html');
  fs.writeFileSync(htmlPath, html, 'utf-8');
  const win = new BrowserWindow({ show: false, width: 900, height: 1200 });
  await win.loadURL(pathToFileURL(htmlPath).href);
  await new Promise((r) => setTimeout(r, 400));
  const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  fs.writeFileSync(path.join(OUT, 'dobble-combo-3hojas.pdf'), pdf);
  fs.rmSync(htmlPath, { force: true });
  win.destroy();
  console.log(`✓ dobble-combo-3hojas.pdf (${(pdf.length / 1024).toFixed(0)} KB) · frentes+dorsos · cartas ${cardIdx} frente / ${backCount} dorso`);
}

app.disableHardwareAcceleration();
app.whenReady().then(main).then(() => app.quit()).catch((e) => { console.error('FALLO:', e); app.exit(1); });
