@echo off
rem Duplo clique: compila o PDFKitty para Windows (64 e 32 bits) e abre a pasta com os executaveis.
rem So 64 bits: compilar-windows.cmd -Bits 64
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File apps\desktop\scripts\windows.ps1 %*
if errorlevel 1 pause
