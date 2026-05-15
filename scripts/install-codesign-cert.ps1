# PrintLayout - Importar certificado de code signing
# -------------------------------------------------
# Importa el certificado publico de La Recta Imprenta en los stores
# TrustedPublisher y Root de la maquina local. Una vez importado,
# los .exe firmados de PrintLayout pasan a ser confiables para Windows
# y para los antivirus de terceros.
#
# Como usarlo:
#   1. Bajar este archivo a la PC.
#   2. Click derecho > "Ejecutar con PowerShell" (acepta UAC para admin).
#      O desde una terminal admin:  powershell -ExecutionPolicy Bypass -File install-codesign-cert.ps1
#
# Lo unico que hace: descarga el .cer desde el repo publico y lo agrega
# a los dos stores. No instala la app ni cambia nada mas.

$ErrorActionPreference = "Stop"

# Auto-elevacion: si no soy admin, relanzo el script con UAC.
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Se requiere admin. Relanzando con UAC..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$certUrl = "https://github.com/LarectaimprentaCBA/PrintLayout/raw/main/build/codesign-public.cer"
$tmpCer = Join-Path $env:TEMP "printlayout-codesign-public.cer"

Write-Host "Descargando certificado desde GitHub..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $certUrl -OutFile $tmpCer -UseBasicParsing

if (-not (Test-Path $tmpCer)) {
    Write-Host "ERROR: no se pudo descargar el certificado." -ForegroundColor Red
    exit 1
}

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $tmpCer
Write-Host ""
Write-Host "Certificado a importar:" -ForegroundColor Green
Write-Host "  Subject:    $($cert.Subject)"
Write-Host "  Issuer:     $($cert.Issuer)"
Write-Host "  Valido:     $($cert.NotBefore) - $($cert.NotAfter)"
Write-Host "  Thumbprint: $($cert.Thumbprint)"
Write-Host ""

# Importar a TrustedPublisher (los AV y SmartScreen lo respetan).
$tpStore = New-Object System.Security.Cryptography.X509Certificates.X509Store("TrustedPublisher", "LocalMachine")
$tpStore.Open("ReadWrite")
$tpStore.Add($cert)
$tpStore.Close()
Write-Host "Importado a TrustedPublisher (LocalMachine)." -ForegroundColor Green

# Importar a Root (asi Windows confia en la cadena entera del self-signed).
$rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", "LocalMachine")
$rootStore.Open("ReadWrite")
$rootStore.Add($cert)
$rootStore.Close()
Write-Host "Importado a Trusted Root CA (LocalMachine)." -ForegroundColor Green

Remove-Item $tmpCer -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Listo. Ahora podes instalar o actualizar PrintLayout sin que el antivirus lo bloquee." -ForegroundColor Cyan
Write-Host ""
Read-Host "Pulsa Enter para cerrar"
