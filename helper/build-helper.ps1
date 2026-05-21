#requires -Version 5
# Compila helper/PrintHelper.cs a helper/PrintHelper.exe y lo firma con el
# cert self-signed de PrintLayout. Correr cuando se edite el .cs; el .exe
# resultante va commiteado al repo (para que el release no dependa de tener
# csc.exe en la PC de build).

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $PSScriptRoot 'PrintHelper.cs'
$out = Join-Path $PSScriptRoot 'PrintHelper.exe'
$pfx = Join-Path $root 'build\codesign.pfx'
$pfxPass = 'PrintLayoutLR2026'

$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    $csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $csc)) {
    throw "No se encontro csc.exe (.NET Framework 4.x)."
}

Write-Host "[helper] Compilando con $csc"
& $csc /nologo /target:winexe /platform:anycpu /optimize+ /out:"$out" `
    /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
    "$src"
if ($LASTEXITCODE -ne 0) { throw "csc fallo con $LASTEXITCODE" }

Write-Host "[helper] Firmando $out"
# Get-PfxCertificate en PS 5.1 no acepta -Password. Cargamos el PFX
# directamente con X509Certificate2 (que si soporta password) y pasamos el
# cert resultante a Set-AuthenticodeSignature.
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
    $pfx, $pfxPass,
    [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable
)
Set-AuthenticodeSignature -FilePath $out -Certificate $cert -HashAlgorithm SHA256 | Out-Null

$sig = Get-AuthenticodeSignature -FilePath $out
Write-Host "[helper] Firma: $($sig.Status) (signer: $($sig.SignerCertificate.Subject))"
if ($sig.Status -ne 'Valid' -and $sig.Status -ne 'UnknownError') {
    throw "Firma fallo: $($sig.Status) $($sig.StatusMessage)"
}

$size = (Get-Item $out).Length
Write-Host "[helper] OK $out ($size bytes)"
