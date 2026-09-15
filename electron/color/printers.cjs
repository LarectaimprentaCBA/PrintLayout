// Enumeración de impresoras CON su IP, y resolución cola→IP. La identidad de una
// impresora para la corrección de color es su IP (el nombre de la cola cambia entre PC).
// Saca la IP del puerto: PrinterHostAddress (Standard TCP/IP) o del nombre "IP_x.x.x.x".
// Colas WSD/IPP sin IP → null (se asigna a mano por PC, ver store.getManualIp).
'use strict';
const { spawn } = require('child_process');

const PS = `
$ErrorActionPreference='SilentlyContinue'
$def = (Get-CimInstance Win32_Printer | Where-Object { $_.Default }).Name
$ports = @{}
Get-PrinterPort | ForEach-Object { if ($_.PrinterHostAddress) { $ports[$_.Name] = $_.PrinterHostAddress } }
Get-CimInstance Win32_Printer | ForEach-Object {
  $ip = $ports[$_.PortName]
  if (-not $ip -and $_.PortName -match '(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})') { $ip = $matches[1] }
  [pscustomobject]@{ Name = $_.Name; IsDefault = ($_.Name -eq $def); Port = $_.PortName; IP = $ip }
} | ConvertTo-Json -Compress
`;

let cache = null;
let cacheAt = 0;
const TTL = 30000;

function runPs() {
  return new Promise((resolve) => {
    let out = '', err = '';
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS], { windowsHide: true });
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', () => resolve({ ok: false, printers: [], error: 'no se pudo listar impresoras' }));
    p.on('close', () => {
      try {
        const t = out.trim();
        if (!t) return resolve({ ok: true, printers: [] });
        let arr = JSON.parse(t);
        if (!Array.isArray(arr)) arr = [arr];
        const printers = arr.map((x) => ({
          name: x.Name, displayName: x.Name, isDefault: !!x.IsDefault,
          port: x.Port || '', ip: x.IP || null,
        }));
        resolve({ ok: true, printers });
      } catch (e) {
        resolve({ ok: false, printers: [], error: 'salida inesperada al listar impresoras' });
      }
    });
  });
}

async function list(force = false) {
  const now = Date.now();
  if (!force && cache && now - cacheAt < TTL) return cache;
  cache = await runPs();
  cacheAt = now;
  return cache;
}

// Resuelve la IP de una cola. manualIp = mapa cola→IP (per-PC) para colas sin IP.
async function resolveIp(deviceName, manualIp = {}) {
  if (!deviceName) return null;
  if (manualIp && manualIp[deviceName]) return manualIp[deviceName];
  const r = await list();
  const found = (r.printers || []).find((p) => p.name === deviceName);
  if (found && found.ip) return found.ip;
  if (manualIp && manualIp[deviceName]) return manualIp[deviceName];
  return null;
}

// Refresca el mapa cola→IP en segundo plano (no lanza). Para tener la IP lista sin
// bloquear la impresión.
async function refresh() {
  try { await list(true); } catch (_) { /* best-effort */ }
}

// Resuelve SIN lanzar PowerShell: solo con lo que ya está en caché + el mapa manual.
// Devuelve la IP o null (null = "no lo sé todavía", el llamador puede resolver esa cola).
function resolveFromCache(deviceName, manualIp = {}) {
  if (!deviceName) return null;
  if (manualIp && manualIp[deviceName]) return manualIp[deviceName];
  if (cache && cache.printers) {
    const found = cache.printers.find((p) => p.name === deviceName);
    if (found && found.ip) return found.ip;
  }
  return null;
}

// Resuelve UNA sola cola con PowerShell, con límite de tiempo. Devuelve IP o null.
// Rápido porque consulta una sola impresora (no enumera todas).
function resolveOneQueue(deviceName, manualIp = {}, timeoutMs = 900) {
  if (!deviceName) return Promise.resolve(null);
  if (manualIp && manualIp[deviceName]) return Promise.resolve(manualIp[deviceName]);
  const q = String(deviceName).replace(/'/g, "''");
  const ps = `
$ErrorActionPreference='SilentlyContinue'
$p = Get-Printer -Name '${q}'
$ip = $null
if ($p) {
  $port = Get-PrinterPort -Name $p.PortName
  if ($port.PrinterHostAddress) { $ip = $port.PrinterHostAddress }
  elseif ($p.PortName -match '(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})') { $ip = $matches[1] }
}
if ($ip) { Write-Output $ip }
`;
  return new Promise((resolve) => {
    let out = '', done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
    const killer = setTimeout(() => { try { p.kill(); } catch (_) {} finish(null); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => { clearTimeout(killer); finish(null); });
    p.on('close', () => {
      clearTimeout(killer);
      const m = out.trim().match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      finish(m ? m[1] : null);
    });
  });
}

module.exports = { list, resolveIp, refresh, resolveFromCache, resolveOneQueue };
