# Compila o PDFKitty para Windows e abre a pasta com os executaveis.
#
#   pnpm --filter desktop windows                 64 e 32 bits
#   pnpm --filter desktop windows -- -Bits 64     so um deles
#
# Entrega, em Desktop\PDFKitty-builds:
#   PDFKitty-64bits-instalador.exe            instalador NSIS
#   PDFKitty-64bits-portatil.exe / .zip       sem instalar
#   PDFKitty-32bits-instalador-offline.exe    WebView2 embutido: maquina antiga e sem internet
#   PDFKitty-32bits-portatil.exe / .zip
#
# Sem [CmdletBinding()]/[Parameter()] de proposito: eles fazem o -Debug comum engolir argumentos.
param(
    [ValidateSet('ambas', '64', '32')]
    [string]$Bits = 'ambas',
    [string]$Destino = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'PDFKitty-builds'),
    [switch]$NaoAbrir
)

$ErrorActionPreference = 'Stop'
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$target = Join-Path $raiz 'apps\desktop\src-tauri\target'

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    $env:PATH = "$env:PATH;$env:APPDATA\npm"
}

$variantes = @(
    @{ Bits = '64'; Triple = $null; Sufixo = 'x64'; Instalador = 'PDFKitty-64bits-instalador.exe'; WebView2Embutido = $false },
    @{ Bits = '32'; Triple = 'i686-pc-windows-msvc'; Sufixo = 'x86'; Instalador = 'PDFKitty-32bits-instalador-offline.exe'; WebView2Embutido = $true }
) | Where-Object { $Bits -eq 'ambas' -or $_.Bits -eq $Bits }

function Falhar([string]$mensagem) {
    Write-Host ""
    Write-Host "FALHOU: $mensagem" -ForegroundColor Red
    [console]::beep(400, 600)
    exit 1
}

# Copia e confere pelo hash: ja aconteceu de um zip sair com o executavel da build anterior.
function Entregar([string]$origem, [string]$nome) {
    $alvo = Join-Path $Destino $nome
    Copy-Item $origem $alvo -Force
    if ((Get-FileHash $origem).Hash -ne (Get-FileHash $alvo).Hash) { Falhar "copia de $nome nao confere" }
    return $alvo
}

# Artefato mais velho que o inicio da compilacao e resto de uma build anterior, nao desta.
function Novo([string]$caminho, [datetime]$inicio) {
    if (-not (Test-Path $caminho)) { Falhar "nao encontrado: $caminho" }
    $item = Get-Item $caminho
    if ($item.LastWriteTime -lt $inicio) { Falhar "artefato velho (de $($item.LastWriteTime)): $caminho" }
    return $item.FullName
}

function GrandeEnderecamento([string]$exe) {
    $fs = [System.IO.File]::OpenRead($exe)
    try {
        $br = New-Object System.IO.BinaryReader($fs)
        $fs.Seek(0x3C, 'Begin') | Out-Null
        $pe = $br.ReadInt32()
        $fs.Seek($pe + 4 + 18, 'Begin') | Out-Null
        return ($br.ReadUInt16() -band 0x0020) -ne 0
    } finally {
        $fs.Close()
    }
}

New-Item -ItemType Directory -Force $Destino | Out-Null
$webCompilada = $false
$relatorio = @()

foreach ($v in $variantes) {
    Write-Host ""
    Write-Host "=== Compilando $($v.Bits) bits ===" -ForegroundColor Cyan
    $inicio = Get-Date

    # Configuracao extra, mesclada sobre o tauri.conf.json so nesta compilacao.
    $extra = @{}
    if ($v.WebView2Embutido) {
        $extra.bundle = @{ windows = @{ webviewInstallMode = @{ type = 'offlineInstaller'; silent = $true } } }
    }
    # A interface e a mesma nas duas arquiteturas: compila uma vez so.
    if ($webCompilada) { $extra.build = @{ beforeBuildCommand = '' } }

    $argumentos = @('--filter', 'desktop', 'package')
    if ($v.Triple) { $argumentos += @('--target', $v.Triple) }
    if ($extra.Count -gt 0) {
        $config = Join-Path $env:TEMP "pdfkitty-build-$($v.Bits).conf.json"
        $extra | ConvertTo-Json -Depth 6 | Set-Content -Encoding ascii $config
        $argumentos += @('--config', $config)
    }

    Push-Location $raiz
    try {
        & pnpm @argumentos
        if ($LASTEXITCODE -ne 0) { Falhar "compilacao de $($v.Bits) bits (codigo $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
    $webCompilada = $true

    $release = if ($v.Triple) { Join-Path $target "$($v.Triple)\release" } else { Join-Path $target 'release' }
    $exe = Novo (Join-Path $release 'pdfkitty.exe') $inicio
    # O nome do instalador carrega a versao: pega o mais recente, e `Novo` confere que e desta build.
    $instaladores = @(Get-ChildItem (Join-Path $release "bundle\nsis\PDFKitty_*_$($v.Sufixo)-setup.exe") -ErrorAction SilentlyContinue)
    if ($instaladores.Count -eq 0) { Falhar "instalador de $($v.Bits) bits nao foi gerado" }
    $setup = Novo ($instaladores | Sort-Object LastWriteTime | Select-Object -Last 1).FullName $inicio

    if ($v.Bits -eq '32' -and -not (GrandeEnderecamento $exe)) {
        Falhar 'o executavel de 32 bits nao e LARGE_ADDRESS_AWARE: ficaria limitado a 2 GB'
    }

    $portatil = Entregar $exe "PDFKitty-$($v.Bits)bits-portatil.exe"
    Entregar $setup $v.Instalador | Out-Null
    $zip = Join-Path $Destino "PDFKitty-$($v.Bits)bits-portatil.zip"
    Compress-Archive -Path $portatil -DestinationPath $zip -CompressionLevel Optimal -Force

    $relatorio += "$($v.Bits) bits: $([math]::Round(((Get-Date) - $inicio).TotalMinutes, 1)) min"
}

Write-Host ""
Write-Host "=== Pronto ===" -ForegroundColor Green
$relatorio | ForEach-Object { Write-Host "  $_" }
Get-ChildItem $Destino -File |
    Sort-Object Name |
    Format-Table Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } }, LastWriteTime -AutoSize |
    Out-String | Write-Host

[console]::beep(1200, 250); [console]::beep(1600, 400)
if (-not $NaoAbrir) { Start-Process explorer.exe $Destino }
