// VERIFICACIÓN CONTRA EL MOTOR DE COLOR DE WINDOWS (mscms.dll), el mismo que
// usan Corel y la cola de impresión.
//
// Exporta el perfil de la calibración activa, hace que Windows convierta los
// 343 colores de la carta de sRGB -> nuestro perfil, y lo compara con aplicar
// la tabla de la calibración directo. Si no coinciden, lo que Corel le manda a
// la impresora NO es lo que manda PrintLayout.
//
// ── POR QUÉ NO SE EXIGE "DIFERENCIA <= 2" ───────────────────────────────────
// Se mide también el PISO del motor: un perfil con la corrección en IDENTIDAD
// (que no hace nada). Lo ideal sería que diera 0, pero Windows devuelve hasta
// 6 sobre 255 (promedio 2,3): es la precisión del propio motor, por el ida y
// vuelta sRGB -> espacio de conexión de 16 bits -> dispositivo. Ningún perfil
// puede bajar de ese piso. El test exige entonces que el perfil REAL no se
// aleje mucho más que ese piso.
//
// Necesita csc.exe (.NET Framework) para compilar helper/CmsCheck.cs. Si no
// está, el test lo dice y se saltea en vez de fallar.
//
// Corre con: npm run test:color-icc-windows

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Lut3 } from '../colorMath.js';
import { Levels } from '../layout.js';
import { buildIccProfile } from '../icc.js';
import { construirPerfil } from '../iccExport.js';

const CAL_PATH = 'C:/Users/4/AppData/Roaming/PrintLayout/color-calibrations.json';
const SRGB = 'C:/Windows/System32/spool/drivers/color/sRGB Color Space Profile.icm';
const CSC = path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const FUENTE = path.resolve('helper/CmsCheck.cs');
const INTENT_RELATIVO = 1;
const BEST_MODE = 3;
// Topes. El piso del motor es ~6 / 2,3 (ver arriba); dejamos margen para que la
// tabla de la calibración lo amplifique, pero no tanto como para tapar un error
// real de codificación (ésos daban 70-136).
const TOPE_PEOR = 15;
const TOPE_PROM = 3;

function salir(msg, code = 0) { console.log(msg); process.exit(code); }

let cal = null;
try {
  const j = JSON.parse(fs.readFileSync(CAL_PATH, 'utf8'));
  cal = (j.calibrations || []).find((c) => c.active && Array.isArray(c.lut) && c.lut.length)
    || (j.calibrations || []).find((c) => Array.isArray(c.lut) && c.lut.length) || null;
} catch { /* sin calibración */ }
if (!cal) salir('SALTEADO: no hay ninguna calibración guardada en esta PC.');
if (!fs.existsSync(SRGB)) salir(`SALTEADO: no está el perfil sRGB de Windows (${SRGB}).`);
if (!fs.existsSync(CSC)) salir('SALTEADO: no está csc.exe (.NET Framework) para compilar el verificador.');

console.log(`Calibración: ${cal.id}  ·  corrige ${cal.correctPrinter?.ip} para parecerse a ${cal.referencePrinter?.ip}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-icc-'));
const exe = path.join(dir, 'CmsCheck.exe');
try {
  execFileSync(CSC, ['-nologo', '-optimize+', `-out:${exe}`, FUENTE], { stdio: 'pipe' });
} catch (err) {
  salir(`SALTEADO: no se pudo compilar el verificador.\n${err.stderr?.toString() || err.message}`);
}

// los 343 colores de la carta
const colores = [];
for (const r of Levels) for (const g of Levels) for (const b of Levels) colores.push([r, g, b]);
const entrada = Buffer.alloc(colores.length * 3);
colores.forEach((c, i) => { entrada[i * 3] = c[0]; entrada[i * 3 + 1] = c[1]; entrada[i * 3 + 2] = c[2]; });
const inRaw = path.join(dir, 'in.raw');
fs.writeFileSync(inRaw, entrada);

/** Convierte los 343 colores con el motor de Windows usando `iccPath`. */
function porWindows(iccPath) {
  const out = path.join(dir, 'out.raw');
  execFileSync(exe, [SRGB, iccPath, inRaw, out, String(INTENT_RELATIVO), String(BEST_MODE)], { stdio: 'pipe' });
  return fs.readFileSync(out);
}

function comparar(sal, esperadoDe) {
  let peor = 0; let suma = 0; let fuera = 0; let caso = null;
  for (let i = 0; i < colores.length; i++) {
    const esp = esperadoDe(colores[i]);
    const obt = [sal[i * 3], sal[i * 3 + 1], sal[i * 3 + 2]];
    const d = Math.max(...[0, 1, 2].map((k) => Math.abs(esp[k] - obt[k])));
    suma += d;
    if (d > 2) fuera++;
    if (d > peor) { peor = d; caso = { in: colores[i], esp: esp.map((v) => Math.round(v)), obt }; }
  }
  return { peor, prom: suma / colores.length, fuera, caso };
}

// ── 1) el PISO del motor: perfil con la corrección en identidad ─────────────
const S = 17;
const li = new Lut3(S);
for (let r = 0; r < S; r++) {
  for (let g = 0; g < S; g++) {
    for (let b = 0; b < S; b++) li.set(r, g, b, (255 * r) / (S - 1), (255 * g) / (S - 1), (255 * b) / (S - 1));
  }
}
const iccId = path.join(dir, 'identidad.icc');
fs.writeFileSync(iccId, Buffer.from(buildIccProfile(
  { lut: Array.from(li.V), lutSize: S, correctPrinter: { ip: '0.0.0.0' } },
  { descripcion: 'identidad', fecha: new Date(Date.UTC(2026, 0, 1)) },
)));
const piso = comparar(porWindows(iccId), (c) => c);

// ── 2) el perfil REAL, por el MISMO camino que usa el botón ─────────────────
const { bytes, fileName } = construirPerfil(cal);
const iccPath = path.join(dir, 'perfil.icc');
fs.writeFileSync(iccPath, Buffer.from(bytes));
const lut = new Lut3(cal.lutSize);
lut.V.set(cal.lut);
const o = new Float64Array(3);
const real = comparar(porWindows(iccPath), (c) => {
  lut.apply(c[0], c[1], c[2], o);
  return [o[0], o[1], o[2]].map((v) => Math.max(0, Math.min(255, v)));
});

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* nada */ }

console.log(`Perfil: ${fileName}  (${Math.round(bytes.length / 1024)} KB)`);
console.log('');
console.log('=== Windows convirtiendo los 343 colores de la carta ===');
console.log(`  PISO del motor (corrección identidad) : peor ${piso.peor.toFixed(1)} · promedio ${piso.prom.toFixed(2)}`);
console.log(`  PERFIL REAL vs aplicar la tabla       : peor ${real.peor.toFixed(1)} · promedio ${real.prom.toFixed(2)}  (${real.fuera} de 343 pasan de 2)`);
if (real.caso) console.log(`  peor caso: rgb(${real.caso.in.join(',')}) -> tabla [${real.caso.esp}] · Windows [${real.caso.obt}]`);

const ok = real.peor <= TOPE_PEOR && real.prom <= TOPE_PROM;
console.log(`\n${ok ? 'OK' : 'FALLA'}: peor ${real.peor.toFixed(1)} (tope ${TOPE_PEOR}) · promedio ${real.prom.toFixed(2)} (tope ${TOPE_PROM})`);
if (ok) {
  console.log('El perfil reproduce la corrección dentro de la precisión del motor de Windows.');
}
process.exit(ok ? 0 : 1);
