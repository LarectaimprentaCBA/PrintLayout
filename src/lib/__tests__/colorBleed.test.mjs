// Sangrado de color de stickers por contorno: el cálculo puro.
// Corre con: npm run test:sangrado-color
import {
  erodeAlpha, paintHalo, bleedAllowances, colorBleedFor, bleedPlacement, maxHaloMm,
} from '../contour/colorBleed.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};

// Sticker de prueba: un disco rojo con un anillo rosa por fuera, sobre nada
// (transparente), como queda después de sacarle el fondo blanco.
function sticker(W, H, cx, cy, rRojo, rRosa) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, dist = Math.hypot(x - cx, y - cy);
    if (dist <= rRojo) { d[i] = 220; d[i + 1] = 40; d[i + 2] = 40; d[i + 3] = 255; }
    else if (dist <= rRosa) { d[i] = 250; d[i + 1] = 190; d[i + 2] = 195; d[i + 3] = 255; }
  }
  return d;
}
const px = (d, W, x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };

console.log('\n1) La franja');
{
  const W = 200, H = 200, cx = 100, cy = 100;
  const d = sticker(W, H, cx, cy, 50, 60);
  const antes = new Uint8ClampedArray(d);
  paintHalo(d, W, H, { radiusPx: 12, insetPx: 2 });

  // Adentro del sticker no cambia nada.
  let cambios = 0;
  for (let i = 0; i < W * H; i++) if (antes[i * 4 + 3] === 255) for (let c = 0; c < 4; c++) if (d[i * 4 + c] !== antes[i * 4 + c]) cambios++;
  check('el dibujo queda exactamente igual', cambios === 0, String(cambios));

  const cerca = px(d, W, cx + 66, cy);    // 6 px afuera del borde
  check('justo afuera del borde se pinta', cerca[3] === 255, cerca.join());
  check('con el color del BORDE (rosa), no el del centro (rojo)',
    cerca[0] === 250 && cerca[1] === 190 && cerca[2] === 195, cerca.join());
  const diag = px(d, W, cx + 46, cy + 46); // en diagonal, ~5 px afuera
  check('también en diagonal', diag[3] === 255 && diag[0] === 250, diag.join());
  check('a 11 px todavía hay franja', px(d, W, cx + 71, cy)[3] === 255, px(d, W, cx + 71, cy).join());
  check('a 14 px ya no (transparente)', px(d, W, cx + 74, cy)[3] === 0, px(d, W, cx + 74, cy).join());
  check('lejos queda transparente', px(d, W, 5, 5)[3] === 0);

  // El ancho real de la franja, medido sobre la fila del centro.
  let ultimo = 0;
  for (let x = cx; x < W; x++) if (d[(cy * W + x) * 4 + 3] >= 128) ultimo = x;
  check('la franja mide lo pedido (12 px ± 1)', Math.abs((ultimo - (cx + 60)) - 12) <= 1, String(ultimo - (cx + 60)));
}

console.log('\n2) Borde lavado (mezcla con el blanco): no se estira ese color');
{
  // Mismo sticker, pero el último píxel del borde viene "lavado" casi blanco,
  // como pasa en cualquier imagen sobre fondo blanco.
  const W = 200, H = 200, cx = 100, cy = 100;
  const d = sticker(W, H, cx, cy, 50, 60);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dist = Math.hypot(x - cx, y - cy);
    if (dist > 59 && dist <= 60) { const i = (y * W + x) * 4; d[i] = 253; d[i + 1] = 240; d[i + 2] = 241; }
  }
  erodeAlpha(d, W, H);
  check('la erosión le saca 1 px al borde', px(d, W, cx + 60, cy)[3] === 0 && px(d, W, cx + 58, cy)[3] === 255);
  paintHalo(d, W, H, { radiusPx: 12, insetPx: 2 });
  const f = px(d, W, cx + 66, cy);
  check('la franja sale rosa, no lavada', f[0] === 250 && f[1] === 190 && f[2] === 195, f.join());
}

console.log('\n3) Sin nada opaco no explota ni pinta');
{
  const d = new Uint8ClampedArray(20 * 20 * 4);
  paintHalo(d, 20, 20, { radiusPx: 5 });
  check('queda todo transparente', d.every((v) => v === 0));
}

console.log('\n4) Cuánto puede salirse cada celda sin pisar a la vecina');
{
  // Dos celdas de 50×50 separadas 3 mm, lejos de todo lo demás.
  const a = bleedAllowances([{ x: 10, y: 10, w: 50, h: 50 }, { x: 63, y: 10, w: 50, h: 50 }], 2);
  check('hacia la vecina: la mitad del hueco (1,5 mm)', a[0].r === 1.5 && a[1].l === 1.5, JSON.stringify(a));
  check('hacia los lados libres: lo pedido (2 mm)', a[0].l === 2 && a[0].t === 2 && a[0].b === 2 && a[1].r === 2);
  const pegadas = bleedAllowances([{ x: 0, y: 0, w: 50, h: 50 }, { x: 50, y: 0, w: 50, h: 50 }], 2);
  check('celdas pegadas: 0 hacia la vecina', pegadas[0].r === 0 && pegadas[1].l === 0);
  const lejos = bleedAllowances([{ x: 0, y: 0, w: 50, h: 50 }, { x: 80, y: 0, w: 50, h: 50 }], 2);
  check('hueco grande: lo pedido', lejos[0].r === 2 && lejos[1].l === 2);
  const abajo = bleedAllowances([{ x: 0, y: 0, w: 50, h: 50 }, { x: 0, y: 51, w: 50, h: 50 }], 2);
  check('vecina de abajo: mitad del hueco', abajo[0].b === 0.5 && abajo[1].t === 0.5 && abajo[0].r === 2);
  const diag = bleedAllowances([{ x: 0, y: 0, w: 50, h: 50 }, { x: 51, y: 51, w: 50, h: 50 }], 2);
  check('vecina en diagonal muy cerca: también limita', diag[0].r === 0.5 && diag[0].b === 0.5, JSON.stringify(diag[0]));
  // Con el recorte resultante, ninguna franja entra en la celda de al lado.
  const cs = [{ x: 10, y: 10, w: 50, h: 50 }, { x: 63, y: 10, w: 50, h: 50 }, { x: 10, y: 61, w: 50, h: 50 }, { x: 62, y: 62, w: 50, h: 50 }];
  const al = bleedAllowances(cs, 3);
  let pisa = 0;
  cs.forEach((c, i) => {
    const r = { x0: c.x - al[i].l, y0: c.y - al[i].t, x1: c.x + c.w + al[i].r, y1: c.y + c.h + al[i].b };
    cs.forEach((o, j) => { if (i !== j && r.x0 < o.x + o.w - 1e-9 && r.x1 > o.x + 1e-9 && r.y0 < o.y + o.h - 1e-9 && r.y1 > o.y + 1e-9) pisa++; });
  });
  check('en una hoja de 4, nadie pisa a nadie', pisa === 0, String(pisa));
}

console.log('\n5) Cuándo va y cuándo no');
{
  const base = { cutShape: 'contour', contourColorBleedMm: 2 };
  check('hoja por contorno con valor: va', !!colorBleedFor(base, 'a'));
  check('franja = lo pedido', colorBleedFor(base, 'a').haloMm === 2);
  check('valor 0: no va', colorBleedFor({ ...base, contourColorBleedMm: 0 }, 'a') === null);
  check('sin el campo (hojas viejas): no va', colorBleedFor({ cutShape: 'contour' }, 'a') === null);
  check('hoja que no es por contorno: no va', colorBleedFor({ cutShape: 'rect', contourColorBleedMm: 2 }, 'a') === null);
  check('imagen en "rellenar": no va', colorBleedFor(base, 'a', { fitMode: 'cover' }) === null);
  check('imagen con borde blanco: no va', colorBleedFor(base, 'a', { borderMm: 3 }) === null);
  check('imagen girada por el casillero: no va', colorBleedFor(base, 'a', { rotated: true }) === null);
  check('imagen con forma fija (círculo): no va',
    colorBleedFor({ ...base, contourByImage: { a: { shape: 'circle' } } }, 'a') === null);
  check('…pero las demás de la hoja sí', !!colorBleedFor({ ...base, contourByImage: { a: { shape: 'circle' } } }, 'b'));
  check('si el corte va 1 mm por afuera, la franja llega 1 mm más lejos',
    colorBleedFor({ ...base, contourBleedMm: 1 }, 'a').haloMm === 3);
  check('si el corte va por adentro, la franja no se achica',
    colorBleedFor({ ...base, contourBleedMm: -1 }, 'a').haloMm === 2);
  check('toma la tolerancia propia de la imagen',
    colorBleedFor({ ...base, contourTolerance: 20, contourByImage: { a: { tolerance: 60 } } }, 'a').tolerance === 60);
  check('borde externo (default): no toca huecos', colorBleedFor(base, 'a').detectHoles === false);
  check('huecos que se cortan: se pintan',
    colorBleedFor({ ...base, contourOuterBorder: false, contourIncludeHoles: true }, 'a').detectHoles === true);
  check('huecos que NO se cortan: se dejan como están',
    colorBleedFor({ ...base, contourOuterBorder: false, contourIncludeHoles: false }, 'a').detectHoles === false);
  check('franja máxima de la hoja', maxHaloMm({ ...base, contourBleedMm: 1, contourByImage: { a: { bleedMm: 2.5 } } }) === 4.5);
  check('hoja sin franja: 0', maxHaloMm({ cutShape: 'contour' }) === 0);
}

console.log('\n6) Dónde va en la celda');
{
  // Imagen de 1000×500 en una celda de 100×100: entra a lo ancho, centrada en alto.
  const pl = bleedPlacement({ x: 10, y: 20, w: 100, h: 100 }, 1000, 500, 0.02);
  check('la franja agranda 2 mm de cada lado', Math.abs(pl.padMm - 2) < 1e-9, String(pl.padMm));
  check('posición y tamaño', Math.abs(pl.x - 8) < 1e-9 && Math.abs(pl.y - 43) < 1e-9
    && Math.abs(pl.w - 104) < 1e-9 && Math.abs(pl.h - 54) < 1e-9, JSON.stringify(pl));
}

console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exitCode = fail ? 1 : 0;
