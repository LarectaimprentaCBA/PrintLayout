// "Encoger / agrandar + bleed": el control ya no tiene tope en 100%. Con más de
// 100 la imagen se agranda, lo que se pasa del borde se recorta y el relleno
// cubre solo los lados donde todavía no llega. Es el punto intermedio que
// faltaba entre "encoger" (máximo: entra justo) y "recortar (zoom)" (mínimo: ya
// tapa todo).
//
// Se prueba con el canvas de verdad (por eso corre con electron).
// Corre con: npm run test:agrandar-contenido
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULO = pathToFileURL(path.join(__dirname, '..', 'imageBleed.js')).href;

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};
const cerca = (a, b, tol = 1) => Math.abs(a - b) <= tol;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-agrandar-'));
  const html = path.join(dir, 'p.html');
  fs.writeFileSync(html, '<!doctype html><meta charset="utf-8"><body></body>');
  const win = new BrowserWindow({ show: false, webPreferences: { webSecurity: false, contextIsolation: false } });
  await win.loadFile(html);
  const js = (code) => win.webContents.executeJavaScript(code, true);

  try {
    // Imagen de prueba 300×200 (más angosta que la celda de 90×50): toda roja,
    // con una franja AZUL de 20 px arriba y una VERDE de 20 px abajo, para ver
    // cuánto se recorta de alto.
    await js(`(async () => {
      window.M = await import(${JSON.stringify(MODULO)});
      const c = document.createElement('canvas'); c.width = 300; c.height = 200;
      const x = c.getContext('2d');
      x.fillStyle = '#ff0000'; x.fillRect(0, 0, 300, 200);
      x.fillStyle = '#0000ff'; x.fillRect(0, 0, 300, 20);
      x.fillStyle = '#00ff00'; x.fillRect(0, 180, 300, 20);
      window.IMG = c.toDataURL('image/png');
      // Mide el resultado: tamaño, cuántas columnas/filas son blancas (relleno),
      // cuántas filas azules arriba y verdes abajo quedaron a la vista.
      window.medir = async (cfg) => {
        const out = await M.extendWithMethod(IMG, { w: 90, h: 50 }, { w: 90, h: 50 }, cfg);
        const im = new Image(); await new Promise((r) => { im.onload = r; im.src = out.dataUrl; });
        const k = document.createElement('canvas'); k.width = im.naturalWidth; k.height = im.naturalHeight;
        const g = k.getContext('2d'); g.drawImage(im, 0, 0);
        const W = k.width, H = k.height, d = g.getImageData(0, 0, W, H).data;
        const px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
        const es = (p, r, gg, b) => Math.abs(p[0] - r) < 40 && Math.abs(p[1] - gg) < 40 && Math.abs(p[2] - b) < 40;
        const my = Math.floor(H / 2), mx = Math.floor(W / 2);
        let blancoIzq = 0; while (blancoIzq < W && es(px(blancoIzq, my), 255, 255, 255)) blancoIzq++;
        let blancoDer = 0; while (blancoDer < W && es(px(W - 1 - blancoDer, my), 255, 255, 255)) blancoDer++;
        let y0 = 0; while (y0 < H && es(px(mx, y0), 255, 255, 255)) y0++; // relleno de arriba, si hay
        let azul = 0; while (y0 + azul < H && es(px(mx, y0 + azul), 0, 0, 255)) azul++;
        let y1 = 0; while (y1 < H && es(px(mx, H - 1 - y1), 255, 255, 255)) y1++;
        let verde = 0; while (y1 + verde < H && es(px(mx, H - 1 - y1 - verde), 0, 255, 0)) verde++;
        let transparentes = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 250) transparentes++;
        let blancos = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) blancos++;
        return { W, H, blancoIzq, blancoDer, azul, verde, transparentes, blancos, mm: out.sizeMm };
      };
      return true;
    })()`);
    const medir = (cfg) => js(`medir(${JSON.stringify(cfg)})`);
    const color = (pct, extra = {}) => ({ method: 'shrinkBleed', shrinkPercent: pct, fillMode: 'color', fillOptions: { color: '#ffffff' }, ...extra });

    console.log('\n1) Hasta 100% sigue igual que siempre');
    {
      const a = await medir(color(90));
      // contenido 67.5×45 mm → 300 px de ancho en un lienzo de 400×222.
      check('90%: mismo tamaño de salida que antes', a.W === 400 && a.H === 222, JSON.stringify(a));
      check('90%: blanco parejo a los dos lados', a.blancoIzq === 50 && a.blancoDer === 50, JSON.stringify(a));
      check('90%: no se recorta nada (las dos franjas enteras)', a.azul === 20 && a.verde === 20, JSON.stringify(a));
      const b = await medir(color(100));
      check('100%: toca arriba y abajo, blanco a los lados', b.W === 360 && b.H === 200 && b.blancoIzq === 30 && b.blancoDer === 30, JSON.stringify(b));
      check('100%: no se recorta nada', b.azul === 20 && b.verde === 20, JSON.stringify(b));
    }

    console.log('\n2) Más de 100%: agranda de a poco (lo que faltaba)');
    {
      const a = await medir(color(110));
      // contenido 82.5×55 mm: de ancho todavía no llega (queda blanco, menos que
      // antes) y de alto se pasa 5 mm → se recortan ~9 px arriba y abajo.
      check('110%: queda MENOS blanco a los lados que con 100%', a.blancoIzq > 0 && a.blancoIzq / a.W < 30 / 360, JSON.stringify(a));
      check('110%: blanco parejo a los dos lados', cerca(a.blancoIzq, a.blancoDer), JSON.stringify(a));
      check('110%: el ancho del contenido es el 110% del de 100%', cerca((a.W - a.blancoIzq - a.blancoDer) / a.W, 82.5 / 90, 0.01), JSON.stringify(a));
      check('110%: de alto se recorta un poco, parejo', a.azul > 0 && a.azul < 20 && cerca(a.azul, a.verde), JSON.stringify(a));
      check('110%: el resultado mide lo que la celda', a.mm.w === 90 && a.mm.h === 50, JSON.stringify(a.mm));
      const b = await medir(color(105));
      check('105% queda entre 100% y 110%', b.blancoIzq / b.W < 30 / 360 && b.blancoIzq / b.W > a.blancoIzq / a.W && b.azul > a.azul, JSON.stringify(b));
    }

    console.log('\n3) El punto donde tapa todo = donde arrancaba el zoom');
    {
      const pct = await js(`M.coverShrinkPercent(300 / 200, { w: 90, h: 50 })`);
      check('la celda se tapa justo al 120%', cerca(pct, 120, 0.001), String(pct));
      const a = await medir(color(120));
      const z = await medir({ method: 'crop', cropPercent: 0 });
      check('120%: ya no queda nada de blanco', a.blancos === 0 && a.blancoIzq === 0, JSON.stringify(a));
      check('120% muestra lo mismo que "Recortar (zoom)" en 0', cerca(a.azul / a.H, z.azul / z.H, 0.02) && z.blancos === 0, JSON.stringify({ a, z }));
      const c = await medir(color(150));
      check('150%: sigue agrandando (recorta más)', c.blancos === 0 && c.azul / c.H < a.azul / a.H, JSON.stringify(c));
      const tope = await medir(color(9999));
      check('un valor absurdo no rompe (tope 300%)', tope.W > 0 && tope.blancos === 0, JSON.stringify(tope));
    }

    console.log('\n4) Con los otros rellenos tampoco queda blanco ni huecos');
    for (const [nombre, cfg] of [
      ['espejo', { method: 'shrinkBleed', shrinkPercent: 110, fillMode: 'mirror' }],
      ['edge replicate', { method: 'shrinkBleed', shrinkPercent: 110, fillMode: 'replicate', fillOptions: { stripPx: 8 } }],
      ['ampliar bordes', { method: 'shrinkBleed', shrinkPercent: 110, fillMode: 'edgeGrow', fillOptions: { fillMode: 'stretch' } }],
    ]) {
      const a = await medir(cfg);
      const ref = await medir(color(110));
      check(`${nombre} al 110%: todo relleno, mismo encuadre`, a.transparentes === 0 && a.blancos === 0 && a.W === ref.W && a.H === ref.H && cerca(a.azul, ref.azul), JSON.stringify(a));
    }

    console.log('\n5) Mover la imagen sigue funcionando agrandada');
    {
      const a = await medir(color(110));
      const b = await medir(color(110, { offsetMm: { x: 0, y: 2 } }));
      check('bajarla 2 mm muestra más de arriba y menos de abajo', b.azul > a.azul && b.verde < a.verde, JSON.stringify({ a, b }));
      const c = await medir(color(110, { offsetMm: { x: 2, y: 0 } }));
      check('correrla a la derecha deja más blanco a la izquierda', c.blancoIzq > a.blancoIzq && c.blancoDer < a.blancoDer, JSON.stringify(c));
    }

    console.log('\n6) 9-slice no agranda (estira el marco hasta el borde)');
    {
      const cfg = (p) => ({ method: 'shrinkBleed', shrinkPercent: p, fillMode: 'nineSlice', fillOptions: {} });
      const a = await medir(cfg(100));
      const b = await medir(cfg(150));
      check('150% con 9-slice = 100%', a.W === b.W && a.H === b.H && a.azul === b.azul, JSON.stringify({ a, b }));
    }

    console.log('\n7) Las cuentas');
    {
      const r = await js(`(() => {
        const t = { w: 90, h: 50 };
        return {
          c100: M.shrinkContentSizeMm(1.5, t, 100),
          c110: M.shrinkContentSizeMm(1.5, t, 110),
          ancha: M.shrinkContentSizeMm(3, t, 100),
          cuadrada: M.coverShrinkPercent(1.8, t),
          alta: M.coverShrinkPercent(0.9, t),
          basura: M.shrinkContentSizeMm(1.5, t, 'x'),
        };
      })()`);
      check('100% = entra justo', cerca(r.c100.w, 75, 0.001) && cerca(r.c100.h, 50, 0.001), JSON.stringify(r.c100));
      check('110% = 10% más grande', cerca(r.c110.w, 82.5, 0.001) && cerca(r.c110.h, 55, 0.001), JSON.stringify(r.c110));
      check('imagen más ancha que la celda: manda el ancho', cerca(r.ancha.w, 90, 0.001) && cerca(r.ancha.h, 30, 0.001), JSON.stringify(r.ancha));
      check('misma proporción que la celda: tapa todo al 100%', cerca(r.cuadrada, 100, 0.001), String(r.cuadrada));
      check('imagen vertical en celda apaisada: tapa todo al 200%', cerca(r.alta, 200, 0.001), String(r.alta));
      check('un valor que no es número usa el de siempre (90%)', cerca(r.basura.pct, 0.9, 0.0001), JSON.stringify(r.basura));
    }
  } catch (e) {
    fail++; console.log('  FALLA (excepción)', e && e.stack || e);
  }

  console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  app.exit(fail ? 1 : 0);
});
