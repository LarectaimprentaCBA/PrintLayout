# Descarga Python embeddable + pip + PyMuPDF a python-runtime/
# Necesario antes de buildear la app (npm run dist o npm run installer).
# Se corre una sola vez por maquina de desarrollo.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$rt = Join-Path $root 'python-runtime'

if (Test-Path $rt) {
    Write-Host "python-runtime/ ya existe. Borrar antes si querés rehacerlo."
    exit 0
}

Write-Host "Descargando Python 3.11.9 embeddable..."
$zip = Join-Path $env:TEMP 'python-embed.zip'
Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip' `
    -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath $rt
Remove-Item $zip

Write-Host "Habilitando site-packages..."
$pth = Join-Path $rt 'python311._pth'
@'
python311.zip
.
Lib\site-packages

# Uncomment to run site.main() automatically
import site
'@ | Set-Content -Path $pth -Encoding ASCII

Write-Host "Bootstrap pip..."
$getPip = Join-Path $rt 'get-pip.py'
Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $getPip -UseBasicParsing
& (Join-Path $rt 'python.exe') $getPip --no-warn-script-location | Out-Null

Write-Host "Instalando PyMuPDF..."
& (Join-Path $rt 'python.exe') -m pip install --no-warn-script-location PyMuPDF | Out-Null

Write-Host "OK. python-runtime/ listo en $rt"
