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

# ---------------------------------------------------------------------------
# MODE=pageinfo — no imprime, solo consulta el tamano de hoja / area imprimible
# / margenes / orientacion / duplex de la impresora default. Redirigimos stdin
# desde un archivo UTF-8 SIN BOM (el StreamWriter de PS 5.1 puede meter un
# preamble que corrompe la 1ra linea; Node escribe utf-8 limpio como el archivo).
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[smoke] === MODE=pageinfo ==="
$dev = (Get-CimInstance Win32_Printer | Where-Object { $_.Default }).Name
if (-not $dev) { $dev = (Get-CimInstance Win32_Printer | Select-Object -First 1).Name }
Write-Host "[smoke] Impresora default: $dev"
$inFile = Join-Path $env:TEMP "printlayout-pageinfo.txt"
$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($inFile, "MODE=pageinfo`nDEVICE=$dev`nEND=1`n", $enc)
$errFile = Join-Path $env:TEMP "printlayout-pageinfo-err.txt"
$piOut = & cmd /c "`"$helper`" < `"$inFile`" 2>`"$errFile`""
Write-Host "[smoke] pageinfo stdout:"
Write-Host $piOut
if ($piOut -match 'PAPER_W_MM' -and $piOut -match 'PRINT_W_MM' -and $piOut -match 'DUPLEX=') {
    Write-Host "[smoke] pageinfo OK (devolvio tamano + area imprimible + duplex)."
} else {
    Write-Host "[smoke] pageinfo FALLO — falta alguna clave esperada."
}
Remove-Item $inFile, $errFile -Force -ErrorAction SilentlyContinue
