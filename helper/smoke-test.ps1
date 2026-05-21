#requires -Version 5
# Smoke test del PrintHelper.exe: genera un PNG dummy, invoca el helper con
# input via stdin, espera que muestre el dialog. Cancelar el dialog cuenta
# como exito (verifica que el binario arranca, parsea input y abre la UI).

$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot 'PrintHelper.exe'
if (-not (Test-Path $helper)) { throw "No esta PrintHelper.exe — corre build-helper.ps1 primero" }

# Generar PNG dummy 100x100 negro con texto blanco "TEST".
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 800, 600
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font('Arial', 60)
$g.DrawString('TEST PRINTLAYOUT', $font, [System.Drawing.Brushes]::Black, 20, 200)
$g.Dispose()
$pngPath = Join-Path $env:TEMP "printlayout-smoke.png"
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "[smoke] PNG dummy: $pngPath"

# Input al helper.
$input = @"
SHOW_DIALOG=1
WIDTH_MM=210
HEIGHT_MM=297
PAGE=$pngPath
END=1
"@

Write-Host "[smoke] Lanzando $helper — DEBERIA ABRIRSE EL DIALOGO DE IMPRESION."
Write-Host "[smoke] Cancela el dialogo para terminar el test (no es necesario imprimir)."

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $helper
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true

$p = [System.Diagnostics.Process]::Start($psi)
$p.StandardInput.Write($input)
$p.StandardInput.Close()
$out = $p.StandardOutput.ReadToEnd()
$err = $p.StandardError.ReadToEnd()
$p.WaitForExit()

Write-Host "[smoke] Exit code: $($p.ExitCode)"
Write-Host "[smoke] stdout:"
Write-Host $out
if ($err) {
    Write-Host "[smoke] stderr:"
    Write-Host $err
}

Remove-Item $pngPath -Force -ErrorAction SilentlyContinue
