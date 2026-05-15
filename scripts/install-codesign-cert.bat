@echo off
REM PrintLayout - Importar certificado de code signing
REM ---------------------------------------------------
REM Doble-click a este archivo para correr el script de PowerShell sin
REM tener que tocar la Execution Policy. Va a pedir UAC para admin.
REM
REM Lo unico que hace: descarga el cert publico de PrintLayout desde
REM GitHub y lo importa en TrustedPublisher + Root de la maquina.

set "SCRIPT=%~dp0install-codesign-cert.ps1"

if not exist "%SCRIPT%" (
    echo ERROR: no se encontro install-codesign-cert.ps1 en la misma carpeta.
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
