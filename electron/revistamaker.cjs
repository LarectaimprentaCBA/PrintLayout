// Botón "Revistas": abre RevistaMaker (otra app del taller, programa aparte con
// su propia actualización automática). Si la PC no la tiene, baja el instalador
// publicado y lo instala en silencio — UNA sola vez por PC.
//
// Por qué NO va adentro del instalador de PrintLayout: pesa ~95 MB y cada
// actualización de PrintLayout los arrastraría; además quedarían dos copias
// actualizándose por caminos distintos.
//
// OJO: RevistaMaker NO tiene candado de instancia única. Dos copias abiertas
// comparten la misma carpeta de datos y la segunda no puede guardar bien. Por
// eso, si ya está abierta, la traemos al frente en vez de lanzar otra.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');

const REPO = 'LarectaimprentaCBA/RevistaMaker';
const EXE = 'RevistaMaker.exe';
// Clave de desinstalación que escribe su instalador (sale del appId → es la
// misma en todas las PCs).
const UNINSTALL_GUID = 'd4d9b0d3-78b8-5a0e-b4af-972e4dcedb7c';
const INSTALL_TIMEOUT_MS = 6 * 60 * 1000;

let cachedFetch = null;
function getFetch() {
  if (cachedFetch) return cachedFetch;
  try {
    const electron = require('electron');
    if (electron?.net?.fetch) {
      cachedFetch = electron.net.fetch.bind(electron.net);
      return cachedFetch;
    }
  } catch { /* fuera de Electron (tests en Node) */ }
  cachedFetch = global.fetch;
  return cachedFetch;
}

// El entorno que le pasamos a lo que lanzamos: sin ELECTRON_RUN_AS_NODE (si
// quedara heredado, RevistaMaker arrancaría como Node pelado y no abriría).
function envLimpio() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function ejecutar(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15000, ...opts }, (err, stdout) => {
      resolve({ ok: !err, stdout: String(stdout || '') });
    });
  });
}

// ---------- ¿está instalada? ----------

// De "C:\...\RevistaMaker.exe,0" (DisplayIcon) saca la ruta del .exe.
function rutaDesdeDisplayIcon(valor) {
  const s = String(valor || '').replace(/"/g, '').trim();
  const m = s.match(/^(.*\.exe)(?:,\s*-?\d+)?$/i);
  return m ? m[1] : null;
}

// Lee DisplayIcon de la salida de `reg query … /v DisplayIcon`.
function parsearRegQuery(stdout) {
  const m = String(stdout || '').match(/DisplayIcon\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
  return m ? rutaDesdeDisplayIcon(m[1]) : null;
}

function rutasHabituales(env = process.env) {
  const out = [];
  const local = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  out.push(path.join(local, 'Programs', 'revistamaker', EXE));
  out.push(path.join(local, 'Programs', 'RevistaMaker', EXE));
  for (const pf of [env.ProgramFiles, env['ProgramFiles(x86)']]) {
    if (pf) out.push(path.join(pf, 'RevistaMaker', EXE));
  }
  return out;
}

async function buscarInstalada({ existe = fs.existsSync, env = process.env, reg = ejecutar } = {}) {
  for (const p of rutasHabituales(env)) {
    if (existe(p)) return p;
  }
  // Instalada en otra carpeta: le preguntamos al registro dónde quedó.
  for (const raiz of ['HKCU', 'HKLM']) {
    const clave = `${raiz}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${UNINSTALL_GUID}`;
    // eslint-disable-next-line no-await-in-loop
    const r = await reg('reg', ['query', clave, '/v', 'DisplayIcon']);
    const p = r.ok ? parsearRegQuery(r.stdout) : null;
    if (p && existe(p)) return p;
  }
  return null;
}

// ---------- ¿ya está abierta? ----------

async function estaAbierta() {
  const r = await ejecutar('tasklist', ['/FI', `IMAGENAME eq ${EXE}`, '/FO', 'CSV', '/NH']);
  return r.ok && r.stdout.toLowerCase().includes(EXE.toLowerCase());
}

// Trae la ventana de RevistaMaker al frente (la restaura si estaba minimizada).
// Devuelve true si encontró una ventana.
const PS_AL_FRENTE = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace PL -Name Win -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);'
$p = Get-Process -Name RevistaMaker -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { 'NONE'; exit }
$h = $p.MainWindowHandle
if ([PL.Win]::IsIconic($h)) { [void][PL.Win]::ShowWindowAsync($h, 9) }
if (-not [PL.Win]::SetForegroundWindow($h)) {
  # Windows a veces no deja pasar una ventana ajena al frente (solo titila en
  # la barra). Minimizar y restaurar sí la activa siempre.
  [void][PL.Win]::ShowWindowAsync($h, 6); Start-Sleep -Milliseconds 150
  [void][PL.Win]::ShowWindowAsync($h, 9)
}
'FOCUSED'
`;

async function traerAlFrente() {
  const encoded = Buffer.from(PS_AL_FRENTE, 'utf16le').toString('base64');
  const r = await ejecutar('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
  return r.ok && r.stdout.includes('FOCUSED');
}

function lanzar(exePath) {
  const child = spawn(exePath, [], {
    detached: true,
    stdio: 'ignore',
    cwd: path.dirname(exePath),
    env: envLimpio(),
  });
  child.on('error', () => {});
  child.unref();
}

// ---------- bajar e instalar ----------

// latest.yml de electron-builder → { version, archivo, sha512, size }.
// Solo miramos las líneas SIN sangría (las de arriba del todo).
function parsearLatestYml(texto) {
  const top = {};
  for (const linea of String(texto || '').split(/\r?\n/)) {
    const m = linea.match(/^([A-Za-z0-9]+):\s*(.*)$/);
    if (m) top[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  const size = (String(texto || '').match(/^\s+size:\s*(\d+)/m) || [])[1];
  const archivo = top.path || '';
  if (!top.version || !archivo || !top.sha512) {
    throw new Error('la información de la última versión vino incompleta');
  }
  // El nombre se usa para armar una ruta en disco: nada de barras ni "..".
  if (!/^[\w.\- ]+\.exe$/i.test(archivo) || archivo.includes('..')) {
    throw new Error('el nombre del instalador publicado no es válido');
  }
  return { version: top.version, archivo, sha512: top.sha512, size: size ? Number(size) : null };
}

async function consultarUltima() {
  const f = getFetch();
  const res = await f(`https://github.com/${REPO}/releases/latest/download/latest.yml`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`no se pudo consultar la última versión (${res.status})`);
  return parsearLatestYml(await res.text());
}

function sha512Archivo(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(file).on('error', reject).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('base64')));
  });
}

async function bajarInstalador(info, destDir, onProgreso = () => {}) {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, info.archivo);
  // Si quedó de un intento anterior y está entero, no lo bajamos de nuevo.
  if (fs.existsSync(dest) && (await sha512Archivo(dest)) === info.sha512) return dest;

  const url = `https://github.com/${REPO}/releases/download/v${info.version}/${encodeURIComponent(info.archivo)}`;
  const res = await getFetch()(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`no se pudo bajar el instalador (${res.status})`);
  const total = Number(res.headers.get('content-length')) || info.size || 0;

  const parcial = `${dest}.part`;
  const out = fs.createWriteStream(parcial);
  const hash = crypto.createHash('sha512');
  let bajado = 0;
  let ultimoAviso = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      hash.update(buf);
      bajado += buf.length;
      // eslint-disable-next-line no-await-in-loop
      if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
      const ahora = Date.now();
      if (ahora - ultimoAviso > 300) {
        ultimoAviso = ahora;
        onProgreso({ bajado, total });
      }
    }
    await new Promise((resolve, reject) => { out.on('error', reject); out.end(resolve); });
  } catch (err) {
    out.destroy();
    fs.rmSync(parcial, { force: true });
    throw err;
  }
  if (hash.digest('base64') !== info.sha512) {
    fs.rmSync(parcial, { force: true });
    throw new Error('el instalador se bajó incompleto o dañado; probá de nuevo');
  }
  fs.rmSync(dest, { force: true });
  fs.renameSync(parcial, dest);
  onProgreso({ bajado, total: total || bajado });
  return dest;
}

// El antivirus del taller (Avast) retiene un instalador que ve por primera vez:
// lo analiza ~1 minuto y Windows devuelve "Acceso denegado". Cuando termina de
// analizarlo lo deja correr (probado: el segundo intento instala en 20 s). Por
// eso, ante ese error puntual, esperamos y probamos UNA vez más.
const BLOQUEO = new Set(['EACCES', 'EPERM', 'EBUSY', 'UNKNOWN']);
const MSG_BLOQUEO = 'Windows o el antivirus no dejó correr el instalador. Esperá un minuto y tocá "Revistas" de nuevo';

async function instalarEnSilencio(instalador, { correr = correrInstalador, pausaMs = 8000 } = {}) {
  try {
    await correr(instalador);
  } catch (err) {
    if (!BLOQUEO.has(err?.code)) throw err;
    await new Promise((r) => setTimeout(r, pausaMs));
    try {
      await correr(instalador);
    } catch (err2) {
      if (BLOQUEO.has(err2?.code)) throw new Error(MSG_BLOQUEO);
      throw err2;
    }
  }
}

// Corre el instalador en silencio (/S) y espera a que termine.
function correrInstalador(instalador) {
  return new Promise((resolve, reject) => {
    let listo = false;
    const fin = (fn, v) => { if (!listo) { listo = true; clearTimeout(t); fn(v); } };
    const child = spawn(instalador, ['/S'], { stdio: 'ignore', env: envLimpio() });
    const t = setTimeout(() => {
      fin(reject, new Error('la instalación está tardando demasiado'));
    }, INSTALL_TIMEOUT_MS);
    child.on('error', (err) => fin(reject, err));
    child.on('exit', (code) => {
      if (code === 0) fin(resolve);
      else fin(reject, new Error(`el instalador terminó con error (${code})`));
    });
  });
}

async function esperarInstalada(ms = 15000) {
  const hasta = Date.now() + ms;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const p = await buscarInstalada();
    if (p) return p;
    if (Date.now() > hasta) return null;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ---------- lo que usa el botón ----------

let enCurso = null;

// Abre RevistaMaker; si falta, la instala primero. `aviso` recibe el avance:
//   { fase: 'bajando', pct, mb, totalMb } | { fase: 'instalando' }
// Devuelve { ok, accion: 'abierta'|'al-frente'|'instalada', version? } o
// { ok:false, error, instalador? } (instalador = el .exe ya bajado, para que
// el usuario lo pueda correr a mano si la instalación automática falló).
function abrir({ tempDir, aviso = () => {} } = {}) {
  if (enCurso) return enCurso;
  enCurso = abrirImpl({ tempDir, aviso }).finally(() => { enCurso = null; });
  return enCurso;
}

async function abrirImpl({ tempDir, aviso }) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'RevistaMaker solo está disponible en Windows.' };
  }
  let instalador = null;
  try {
    const exe = await buscarInstalada();
    if (exe) {
      if (await estaAbierta()) {
        if (await traerAlFrente()) return { ok: true, accion: 'al-frente' };
        // Abierta pero sin ventana a la vista (se está cerrando): seguimos y lanzamos.
      }
      lanzar(exe);
      return { ok: true, accion: 'abierta' };
    }

    aviso({ fase: 'bajando', pct: 0 });
    const info = await consultarUltima();
    const dir = path.join(tempDir || os.tmpdir(), 'printlayout-revistamaker');
    instalador = await bajarInstalador(info, dir, ({ bajado, total }) => {
      aviso({
        fase: 'bajando',
        pct: total ? Math.min(100, Math.round((bajado / total) * 100)) : null,
        mb: Math.round(bajado / 1048576),
        totalMb: total ? Math.round(total / 1048576) : null,
      });
    });

    aviso({ fase: 'instalando' });
    await instalarEnSilencio(instalador);
    const nueva = await esperarInstalada();
    if (!nueva) {
      return { ok: false, error: 'El instalador terminó pero RevistaMaker no aparece instalada.', instalador };
    }
    // Algunos instaladores abren la app al terminar: no lanzamos una segunda.
    if (!(await estaAbierta())) lanzar(nueva);
    fs.rmSync(instalador, { force: true });
    return { ok: true, accion: 'instalada', version: info.version };
  } catch (err) {
    const out = { ok: false, error: err?.message || String(err) };
    if (instalador && fs.existsSync(instalador)) out.instalador = instalador;
    return out;
  }
}

module.exports = {
  abrir,
  // expuestos para los tests
  buscarInstalada,
  estaAbierta,
  traerAlFrente,
  consultarUltima,
  bajarInstalador,
  instalarEnSilencio,
  parsearLatestYml,
  parsearRegQuery,
  rutaDesdeDisplayIcon,
  rutasHabituales,
  envLimpio,
  EXE,
};
