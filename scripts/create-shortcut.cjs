const { execFileSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const exePath = path.resolve(__dirname, '..', 'release', 'PrintLayout-win32-x64', 'PrintLayout.exe');
if (!fs.existsSync(exePath)) {
  console.error(`No se encontró el ejecutable en: ${exePath}`);
  console.error('¿Corriste "npm run pack" primero?');
  process.exit(1);
}

const desktop = path.join(os.homedir(), 'Desktop');
const shortcutPath = path.join(desktop, 'PrintLayout.lnk');

const ps = `
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
$s.TargetPath = '${exePath.replace(/'/g, "''")}'
$s.WorkingDirectory = '${path.dirname(exePath).replace(/'/g, "''")}'
$s.IconLocation = '${exePath.replace(/'/g, "''")},0'
$s.Description = 'PrintLayout'
$s.Save()
Write-Output ('OK -> ' + $s.FullName)
`;

try {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf-8',
  });
  console.log(out.trim());
  console.log('Acceso directo creado en el Escritorio.');
} catch (err) {
  console.error('Error creando el acceso directo:', err.message);
  process.exit(1);
}
