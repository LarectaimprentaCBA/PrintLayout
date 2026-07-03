// Test PURO (node, sin canvas) del núcleo de "Ampliar bordes (recorte libre)":
// growEdgesToTransparent rellena cada pixel transparente con el color del opaco
// MÁS CERCANO. Se prueba sobre una forma CÓNCAVA (en U) con tres brazos de
// colores distintos — el caso donde 'radial' (rayos desde el centro) falla y
// éste no: cada hueco toma el color del brazo que tiene al lado.
//
// Correr:  npm run test:bleed
import { growEdgesToTransparent } from '../imageBleed.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + msg); } };

const W = 5, H = 3;
const data = new Uint8ClampedArray(W * H * 4); // todo transparente (alpha 0)
const set = (x, y, r, g, b) => {
  const i = (y * W + x) * 4;
  data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
};
const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

// Forma en U: brazo izq rojo (x=0), brazo der azul (x=4), base verde (y=2).
// Huecos transparentes: (1..3, 0..1).
const RED = [255, 0, 0, 255], BLUE = [0, 0, 255, 255], GREEN = [0, 255, 0, 255];
for (let y = 0; y < 3; y++) { set(0, y, 255, 0, 0); set(4, y, 0, 0, 255); }
for (let x = 1; x <= 3; x++) set(x, 2, 0, 255, 0);

growEdgesToTransparent(data, W, H, 200);

// Cada hueco toma el color del opaco pegado (concavidad resuelta):
ok(eq(px(1, 0), RED), '(1,0) toma el brazo izq rojo');
ok(eq(px(1, 1), RED), '(1,1) toma el brazo izq rojo');
ok(eq(px(3, 0), BLUE), '(3,0) toma el brazo der azul');
ok(eq(px(3, 1), BLUE), '(3,1) toma el brazo der azul');
ok(eq(px(2, 1), GREEN), '(2,1) toma la base verde (el opaco más cercano, no un brazo lejano)');

// Todo quedó opaco (sin transparencia → el corte cae sobre tinta).
let todosOpacos = true;
for (let i = 0; i < W * H; i++) if (data[i * 4 + 3] !== 255) todosOpacos = false;
ok(todosOpacos, 'no queda ningún pixel transparente');

// Un opaco no se pisa (el diseño no se toca).
ok(eq(px(0, 0), RED) && eq(px(4, 2), BLUE) && eq(px(2, 2), GREEN), 'los pixeles del diseño no se modifican');

console.log(`\n==== ${pass} OK, ${fail} FALLOS ====`);
process.exit(fail ? 1 : 0);
