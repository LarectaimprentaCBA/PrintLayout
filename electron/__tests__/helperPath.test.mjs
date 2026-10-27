// Si el antivirus se lleva el PrintHelper, la app tiene que reponerlo sola.
//
// Pasó de verdad (27/10/2026): Avast borró
//   ...\printlayout\resources\PrintHelper.exe
// y además BLOQUEA que se vuelva a escribir ahí ("Acceso denegado"). Comprobado
// que es por NOMBRE y no por contenido: los mismos bytes copiados como
// "plhelper.bin" entran sin problema y el ejecutable corre igual. Sin
// PrintHelper no se imprime NADA, así que esto no puede volver a romperse en
// silencio.
//
// Corre con: npm run test:helper-path

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buscarPrintHelper, MSG_SIN_HELPER } = require('../helper-path.cjs');

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};

// Arma un escenario: carpetas vacías y, opcionalmente, los archivos que existen.
function escenario({ conDev = false, conResources = false, conRepuesto = true, conGuardado = false } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-helper-'));
  const appDir = path.join(raiz, 'app', 'electron');
  const resourcesPath = path.join(raiz, 'resources');
  const userDataDir = path.join(raiz, 'userData');
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(resourcesPath, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  const escribir = (p, txt) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); };
  if (conDev) escribir(path.join(raiz, 'app', 'helper', 'PrintHelper.exe'), 'DEV');
  if (conResources) escribir(path.join(resourcesPath, 'PrintHelper.exe'), 'INSTALADO');
  if (conRepuesto) escribir(path.join(appDir, 'bin', 'plhelper.bin'), 'REPUESTO');
  if (conGuardado) escribir(path.join(userDataDir, 'bin', 'plhelper.bin'), 'GUARDADO');
  return { raiz, appDir, resourcesPath, userDataDir };
}
const limpiar = (e) => { try { fs.rmSync(e.raiz, { recursive: true, force: true }); } catch { /* nada */ } };
const leer = (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return null; } };

console.log('\n1) Instalación sana: usa el de resources');
{
  const e = escenario({ conResources: true });
  const r = buscarPrintHelper(e);
  check('devuelve el de resources', r === path.join(e.resourcesPath, 'PrintHelper.exe'), String(r));
  check('no deja nada en userData', !fs.existsSync(path.join(e.userDataDir, 'bin')));
  limpiar(e);
}

console.log('\n2) En desarrollo manda el del repo');
{
  const e = escenario({ conDev: true, conResources: true });
  const r = buscarPrintHelper(e);
  check('gana helper/PrintHelper.exe', leer(r) === 'DEV', String(r));
  limpiar(e);
}

console.log('\n3) El antivirus se llevó el de resources: lo repone');
{
  const e = escenario({ conResources: false });
  const avisos = [];
  const r = buscarPrintHelper({ ...e, log: (m) => avisos.push(m) });
  const esperado = path.join(e.userDataDir, 'bin', 'plhelper.bin');
  check('devuelve el repuesto en userData', r === esperado, String(r));
  check('y el archivo existe de verdad', fs.existsSync(esperado));
  check('con el contenido del repuesto', leer(esperado) === 'REPUESTO', String(leer(esperado)));
  check('no se llama .exe (Avast bloquea ESE nombre)', path.extname(esperado) !== '.exe');
  check('queda anotado qué pasó', avisos.some((m) => /repuesto en/.test(m)), avisos.join(' | '));
  limpiar(e);
}

console.log('\n4) Ya repuesto antes: lo reusa, no lo copia de nuevo');
{
  const e = escenario({ conResources: false, conGuardado: true });
  const avisos = [];
  const r = buscarPrintHelper({ ...e, log: (m) => avisos.push(m) });
  check('devuelve el que ya estaba', leer(r) === 'GUARDADO', String(leer(r)));
  check('no vuelve a copiar', avisos.length === 0, avisos.join(' | '));
  limpiar(e);
}

console.log('\n5) Sin repuesto tampoco: avisa, no rompe');
{
  const e = escenario({ conResources: false, conRepuesto: false });
  const avisos = [];
  const r = buscarPrintHelper({ ...e, log: (m) => avisos.push(m) });
  check('devuelve null', r === null, String(r));
  check('lo deja anotado', avisos.some((m) => /no hay repuesto/.test(m)), avisos.join(' | '));
  limpiar(e);
}

console.log('\n6) El mensaje al usuario dice qué hacer');
{
  check('nombra al antivirus', /antivirus/i.test(MSG_SIN_HELPER));
  check('dice que hay que excluir la carpeta', /exclusi/i.test(MSG_SIN_HELPER));
  check('no es solo jerga', MSG_SIN_HELPER.length > 60);
}

console.log('\n7) El repuesto del paquete está y es el PrintHelper de verdad');
{
  const repuesto = new URL('../bin/plhelper.bin', import.meta.url);
  const real = new URL('../../helper/PrintHelper.exe', import.meta.url);
  if (!fs.existsSync(repuesto)) {
    check('existe electron/bin/plhelper.bin (lo hace npm run build)', false, 'falta: corré npm run build');
  } else {
    const a = fs.readFileSync(repuesto);
    const b = fs.existsSync(real) ? fs.readFileSync(real) : null;
    check('existe electron/bin/plhelper.bin', true);
    check('empieza con MZ (es un ejecutable)', a[0] === 0x4d && a[1] === 0x5a);
    check('es idéntico a helper/PrintHelper.exe', b ? Buffer.compare(a, b) === 0 : false,
      b ? 'difieren' : 'no está helper/PrintHelper.exe');
  }
}

console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exit(fail ? 1 : 0);
