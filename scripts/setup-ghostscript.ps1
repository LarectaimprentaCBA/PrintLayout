# Prepara ghostscript/ (motor de PDF embebido) para bundlear con el instalador.
# Igual que setup-python.ps1: la carpeta va gitignoreada y se regenera con este
# script. Copia SOLO lo necesario para correr gswin64c.exe portable:
#   bin/gswin64c.exe + bin/gsdll64.dll, lib/, Resource/, iccprofiles/
# (no copia doc/examples/GUI). Se usa para "Reparar PDF (para Corel)":
# re-destila PDFs de Canva y saca protecciones para que abran editables en Corel.
#
# Uso:  powershell -File scripts/setup-ghostscript.ps1
#       (opcional) -Source "C:\Program Files\gs\gs10.03.1"

param(
  [string]$Source = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root "ghostscript"

function Find-Ghostscript {
  # Busca la instalacion de Ghostscript mas nueva en Program Files.
  $bases = @("$env:ProgramFiles\gs", "${env:ProgramFiles(x86)}\gs")
  foreach ($b in $bases) {
    if (Test-Path $b) {
      $ver = Get-ChildItem $b -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
      if ($ver -and (Test-Path (Join-Path $ver.FullName "bin\gswin64c.exe"))) {
        return $ver.FullName
      }
    }
  }
  return $null
}

if ([string]::IsNullOrWhiteSpace($Source)) { $Source = Find-Ghostscript }
if ([string]::IsNullOrWhiteSpace($Source) -or -not (Test-Path (Join-Path $Source "bin\gswin64c.exe"))) {
  Write-Error "No se encontro Ghostscript. Instalalo (https://ghostscript.com/releases/gsdnld.html) o pasa -Source <carpeta gsXX.YY.Z>."
  exit 1
}

Write-Host "Ghostscript origen: $Source"
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $dest "bin") -Force | Out-Null

Copy-Item (Join-Path $Source "bin\gswin64c.exe") (Join-Path $dest "bin\") -Force
Copy-Item (Join-Path $Source "bin\gsdll64.dll") (Join-Path $dest "bin\") -Force
Copy-Item (Join-Path $Source "lib")         (Join-Path $dest "lib")         -Recurse -Force
Copy-Item (Join-Path $Source "Resource")    (Join-Path $dest "Resource")    -Recurse -Force
Copy-Item (Join-Path $Source "iccprofiles") (Join-Path $dest "iccprofiles") -Recurse -Force

$mb = [math]::Round(((Get-ChildItem $dest -Recurse -File | Measure-Object Length -Sum).Sum/1MB), 1)
Write-Host "ghostscript/ listo: $mb MB en $dest"
