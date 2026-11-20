// "Cortar x2": cada figura se corta dos veces SEGUIDAS y recién después se pasa
// a la siguiente. Se arma el corte de verdad (mismo script que usa la app) pero
// a un archivo, sin conectarse al plotter.
// Corre con: npm run test:cortar-x2
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const embebido = path.join(REPO, 'python-runtime', 'python.exe');
const PY = fs.existsSync(embebido) ? embebido : 'python';
const SCRIPT = path.join(REPO, 'python', 'send_to_plotter.py');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-cortarx2-'));

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};

let n = 0;
function armar(extra) {
  const outPath = path.join(dir, `c${n++}.plt`);
  const r = spawnSync(PY, [SCRIPT], {
    input: JSON.stringify({ pageWidthMm: 320, pageHeightMm: 450, markMarginMm: 10, bladeOffsetMm: 0.25, outPath, ...extra }),
    encoding: 'utf8',
  });
  let res = null;
  try { res = JSON.parse(String(r.stdout).trim()); } catch { /* se informa abajo */ }
  const txt = res && res.ok ? fs.readFileSync(outPath, 'latin1') : '';
  return { res, txt, crudo: `${r.stdout}${r.stderr}` };
}
// Las figuras del archivo: cada una es "U<inicio> D… D… U<fin>". Se saltea el
// trazo de prueba de la cuchilla (empieza con U-) y el estacionado del final.
function figuras(txt) {
  const out = [];
  let actual = null;
  for (const t of txt.split(/\s+/)) {
    if (/^U-/.test(t) || /^D-/.test(t)) continue; // prueba de cuchilla
    if (/^U\d/.test(t)) {
      if (actual && actual.length > 1) { actual.push(t); out.push(actual.join(' ')); actual = null; }
      else actual = [t];
    } else if (/^D\d/.test(t) && actual) actual.push(t);
  }
  return out;
}
const cuadrado = (x, y, l) => [[x, y], [x + l, y], [x + l, y + l], [x, y + l], [x, y]];

// Tres piezas; la segunda tiene un agujero adentro (que va ANTES que su borde).
const cortes = [
  cuadrado(30, 40, 50),
  cuadrado(120, 40, 50),
  cuadrado(135, 55, 10), // agujero de la segunda pieza
  cuadrado(30, 140, 50),
];

console.log('\n1) El corte normal no cambia');
const normal = armar({ cortes });
const uno = armar({ cortes, pasadas: 1 });
check('se arma el corte', !!(normal.res && normal.res.ok), normal.crudo);
check('"Cortar" (sin pasadas) sale igual que con 1 pasada', normal.txt.length > 0 && normal.txt === uno.txt);
check('4 figuras, una pasada', normal.res && normal.res.polilineas === 4 && normal.res.figuras === 4 && normal.res.pasadas === 1, JSON.stringify(normal.res));
const fN = figuras(normal.txt);
check('se leen las 4 figuras del archivo', fN.length === 4, String(fN.length));

console.log('\n2) Cortar x2');
const doble = armar({ cortes, pasadas: 2 });
const fD = figuras(doble.txt);
check('se arma el corte', !!(doble.res && doble.res.ok), doble.crudo);
check('avisa 4 figuras, 2 pasadas, 8 trazos', doble.res && doble.res.figuras === 4 && doble.res.pasadas === 2 && doble.res.polilineas === 8, JSON.stringify(doble.res));
check('el archivo tiene 8 trazos', fD.length === 8, String(fD.length));
check('cada figura se repite pegada a sí misma (1,1,2,2,3,3,4,4)', fN.every((f, i) => fD[2 * i] === f && fD[2 * i + 1] === f));
check('mismo orden de piezas que el corte normal', fN.join('|') === fD.filter((_, i) => i % 2 === 0).join('|'));
// El agujero es la figura más chica: tiene que seguir yendo antes que su borde.
const largo = (f) => { const p = f.split(' ').map((t) => t.slice(1).split(',').map(Number)); return Math.abs(p[1][0] - p[0][0]) + Math.abs(p[1][1] - p[0][1]); };
const chico = fD.reduce((m, f) => (largo(f) < largo(m) ? f : m), fD[0]);
const primeroChico = fD.indexOf(chico);
check('el agujero se corta (dos veces) ANTES que el borde de su pieza', fD[primeroChico + 1] === chico && largo(fD[primeroChico + 2]) > largo(chico) && fD[primeroChico + 2] === fD[primeroChico + 3], JSON.stringify(fD.map(largo)));
const cab = (t) => t.slice(0, t.indexOf(fN[0]));
check('el encabezado (hoja, marcas, cuchilla) es idéntico', cab(normal.txt) === cab(doble.txt) && cab(normal.txt).length > 20);
check('termina igual (estaciona en el mismo lugar)', normal.txt.slice(normal.txt.lastIndexOf(' U')) === doble.txt.slice(doble.txt.lastIndexOf(' U')));

console.log('\n3) Valores raros');
check('pasadas vacío o inválido = corte normal', armar({ cortes, pasadas: null }).txt === normal.txt && armar({ cortes, pasadas: 'x' }).txt === normal.txt && armar({ cortes, pasadas: 0 }).txt === normal.txt);
const mucho = armar({ cortes, pasadas: 99 });
check('un número absurdo queda limitado (máximo 5)', mucho.res && mucho.res.pasadas === 5 && mucho.res.polilineas === 20, JSON.stringify(mucho.res));
const lineas = armar({ cortes: [[[20, 20], [20, 200]], [[80, 20], [80, 200]]], pasadas: 2 });
const fL = figuras(lineas.txt);
check('líneas sueltas (corte lineal): cada una dos veces, en el mismo sentido', fL.length === 4 && fL[0] === fL[1] && fL[2] === fL[3] && fL[0] !== fL[2], JSON.stringify(fL));

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* da igual */ }
console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exitCode = fail ? 1 : 0;
