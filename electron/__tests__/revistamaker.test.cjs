// Botón "Revistas" (electron/revistamaker.cjs): las partes que se pueden probar
// sin tocar la PC — leer la versión publicada, ubicar el programa instalado y
// bajar el instalador verificando que llegó entero (contra un servidor local).
//   node electron/__tests__/revistamaker.test.cjs
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');

const rm = require('../revistamaker.cjs');

let ok = 0; let fail = 0;
function check(nombre, cond, extra = '') {
  if (cond) { ok++; } else { fail++; console.log(`  FALLO: ${nombre} ${extra}`); }
}
async function lanza(fn) { try { await fn(); return null; } catch (e) { return e; } }

(async () => {
  // --- latest.yml ---
  const YML = [
    'version: 0.2.0',
    'files:',
    '  - url: RevistaMaker-Setup-0.2.0.exe',
    '    sha512: AAAA/de+adentro==',
    '    size: 99226592',
    'path: RevistaMaker-Setup-0.2.0.exe',
    'sha512: g8gXOhJRnr/ZyG+abc==',
    "releaseDate: '2026-05-19T21:25:55.465Z'",
  ].join('\n');
  const info = rm.parsearLatestYml(YML);
  check('yml version', info.version === '0.2.0');
  check('yml archivo', info.archivo === 'RevistaMaker-Setup-0.2.0.exe');
  check('yml sha512 = el de arriba, no el de files', info.sha512 === 'g8gXOhJRnr/ZyG+abc==');
  check('yml size', info.size === 99226592);
  check('yml CRLF', rm.parsearLatestYml(YML.replace(/\n/g, '\r\n')).archivo === info.archivo);
  check('yml incompleto → error', !!(await lanza(() => rm.parsearLatestYml('version: 1.0.0\n'))));
  check('yml vacío → error', !!(await lanza(() => rm.parsearLatestYml(''))));
  for (const malo of ['..\\..\\evil.exe', '../x.exe', 'C:\\x.exe', 'a/b.exe', 'setup.bat', 'x..exe']) {
    const e = await lanza(() => rm.parsearLatestYml(`version: 1.0.0\npath: ${malo}\nsha512: abc\n`));
    check(`yml rechaza nombre "${malo}"`, !!e);
  }

  // --- registro ---
  check('DisplayIcon con ,0', rm.rutaDesdeDisplayIcon('C:\\Users\\4\\AppData\\Local\\Programs\\revistamaker\\RevistaMaker.exe,0') === 'C:\\Users\\4\\AppData\\Local\\Programs\\revistamaker\\RevistaMaker.exe');
  check('DisplayIcon sin índice', rm.rutaDesdeDisplayIcon('D:\\Apps\\RevistaMaker.exe') === 'D:\\Apps\\RevistaMaker.exe');
  check('DisplayIcon entre comillas', rm.rutaDesdeDisplayIcon('"D:\\Mis Apps\\RevistaMaker.exe",0') === 'D:\\Mis Apps\\RevistaMaker.exe');
  check('DisplayIcon basura', rm.rutaDesdeDisplayIcon('nada') === null);
  const REG = '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\d4d9\r\n    DisplayIcon    REG_SZ    D:\\Otra Carpeta\\RevistaMaker.exe,0\r\n\r\n';
  check('reg query', rm.parsearRegQuery(REG) === 'D:\\Otra Carpeta\\RevistaMaker.exe');
  check('reg query vacío', rm.parsearRegQuery('ERROR: no se encuentra') === null);

  // --- ubicar la instalación ---
  const env = { LOCALAPPDATA: 'C:\\U\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
  const habitual = path.join(env.LOCALAPPDATA, 'Programs', 'revistamaker', 'RevistaMaker.exe');
  let regLlamado = 0;
  const regNo = async () => { regLlamado++; return { ok: false, stdout: '' }; };
  check('instalada en la carpeta habitual', (await rm.buscarInstalada({ existe: (p) => p === habitual, env, reg: regNo })) === habitual);
  check('…sin consultar el registro', regLlamado === 0);
  check('no instalada → null', (await rm.buscarInstalada({ existe: () => false, env, reg: regNo })) === null);
  check('…consultó HKCU y HKLM', regLlamado === 2);
  const otra = 'D:\\Otra Carpeta\\RevistaMaker.exe';
  check('instalada en otra carpeta (registro)', (await rm.buscarInstalada({ existe: (p) => p === otra, env, reg: async () => ({ ok: true, stdout: REG }) })) === otra);
  check('registro apunta a algo que ya no existe → null', (await rm.buscarInstalada({ existe: () => false, env, reg: async () => ({ ok: true, stdout: REG }) })) === null);

  // --- entorno de lanzamiento ---
  process.env.ELECTRON_RUN_AS_NODE = '1';
  check('env sin ELECTRON_RUN_AS_NODE', !('ELECTRON_RUN_AS_NODE' in rm.envLimpio()));
  check('env conserva el resto', rm.envLimpio().PATH === process.env.PATH);
  delete process.env.ELECTRON_RUN_AS_NODE;

  // --- el antivirus retiene el instalador la primera vez ---
  const errCod = (code) => Object.assign(new Error(`spawn ${code}`), { code });
  let n = 0;
  await rm.instalarEnSilencio('x.exe', { pausaMs: 1, correr: async () => { n++; } });
  check('instala al primer intento → no reintenta', n === 1);
  n = 0;
  const eA = await lanza(() => rm.instalarEnSilencio('x.exe', { pausaMs: 1, correr: async () => { n++; if (n === 1) throw errCod('EACCES'); } }));
  check('"Acceso denegado" la 1ra vez → reintenta y sale bien', !eA && n === 2);
  n = 0;
  const eB = await lanza(() => rm.instalarEnSilencio('x.exe', { pausaMs: 1, correr: async () => { n++; throw errCod('EPERM'); } }));
  check('bloqueado las dos veces → un solo reintento', n === 2);
  check('…y mensaje entendible (sin códigos)', !!eB && /antivirus/.test(eB.message) && !/EPERM|spawn/.test(eB.message), eB?.message);
  n = 0;
  const eC = await lanza(() => rm.instalarEnSilencio('x.exe', { pausaMs: 1, correr: async () => { n++; throw new Error('el instalador terminó con error (2)'); } }));
  check('otro tipo de error → no reintenta', n === 1 && /terminó con error/.test(eC?.message || ''));

  // --- bajar el instalador (servidor local que imita a GitHub) ---
  const contenido = crypto.randomBytes(3 * 1024 * 1024 + 123);
  const sha = crypto.createHash('sha512').update(contenido).digest('base64');
  let modo = 'bien'; let pedidos = 0;
  const srv = http.createServer((req, res) => {
    pedidos++;
    if (modo === '404') { res.writeHead(404); res.end('no'); return; }
    const cuerpo = modo === 'cortado' ? contenido.subarray(0, 1000) : contenido;
    res.writeHead(200, { 'content-length': cuerpo.length });
    res.end(cuerpo);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const fetchReal = global.fetch;
  global.fetch = (url, opts) => fetchReal(String(url).replace('https://github.com', base), opts);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-revista-test-'));
  const meta = { version: '9.9.9', archivo: 'RevistaMaker-Setup-9.9.9.exe', sha512: sha, size: contenido.length };
  try {
    const avisos = [];
    const dest = await rm.bajarInstalador(meta, dir, (p) => avisos.push(p));
    check('bajó a la carpeta pedida', dest === path.join(dir, meta.archivo));
    check('el archivo es idéntico', fs.readFileSync(dest).equals(contenido));
    check('no deja .part', !fs.existsSync(`${dest}.part`));
    const ult = avisos[avisos.length - 1];
    check('avisa el avance hasta el final', !!ult && ult.bajado === contenido.length && ult.total === contenido.length);

    const antes = pedidos;
    await rm.bajarInstalador(meta, dir);
    check('si ya está entero no lo baja de nuevo', pedidos === antes);

    fs.rmSync(dest);
    modo = 'cortado';
    const e1 = await lanza(() => rm.bajarInstalador(meta, dir));
    check('descarga dañada → error', !!e1 && /incompleto|dañado/.test(e1.message), e1?.message);
    check('…y no deja instalador a medias', !fs.existsSync(dest) && !fs.existsSync(`${dest}.part`));

    modo = '404';
    const e2 = await lanza(() => rm.bajarInstalador(meta, dir));
    check('sin publicación (404) → error claro', !!e2 && /404/.test(e2.message), e2?.message);

    // Un archivo viejo/dañado con el mismo nombre se reemplaza.
    modo = 'bien';
    fs.writeFileSync(dest, 'basura');
    await rm.bajarInstalador(meta, dir);
    check('pisa un instalador dañado que había quedado', fs.readFileSync(dest).equals(contenido));
  } finally {
    global.fetch = fetchReal;
    // Cerrar del todo antes de salir: en Windows, salir con conexiones a medio
    // cerrar hace abortar a Node ("Assertion failed … UV_HANDLE_CLOSING").
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(fail === 0 ? `revistamaker: ${ok} OK` : `revistamaker: ${fail} FALLOS, ${ok} OK`);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
