# Executa o Tauri CLI para Android com o ambiente resolvido, em vez de assumido.
#
# Existe porque este projeto ja perdeu tempo tres vezes com ferramenta instalada
# que o shell nao enxergava (Rust na fase 18, pnpm e o JDK na fase 20). O erro
# nativo dessas situacoes nunca diz "variavel de ambiente faltando": diz
# "Unsupported class file major version 69", ou simplesmente nao encontra o NDK.
#
# Uso: powershell -File scripts/android.ps1 build --debug --apk --target aarch64

# Sem bloco param() de proposito: declarar [Parameter()] torna isto uma funcao avancada, e
# o -Debug comum do PowerShell passa a engolir o --debug destinado ao Tauri. Com $args
# automatico, tudo atravessa intacto.
$ErrorActionPreference = 'Stop'

function Fail($mensagem) {
    Write-Error $mensagem
    exit 1
}

# --- SDK ---------------------------------------------------------------------
$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path $sdk)) {
    Fail "SDK do Android nao encontrado em '$sdk'. Instale pelo Android Studio ou defina ANDROID_HOME."
}

# --- NDK: a versao mais alta instalada ---------------------------------------
$ndk = $env:NDK_HOME
if (-not $ndk) {
    $ndkRoot = Join-Path $sdk 'ndk'
    if (-not (Test-Path $ndkRoot)) {
        Fail "NDK nao encontrado em '$ndkRoot'. Instale pelo SDK Manager (seccao NDK (Side by side))."
    }
    $ndk = (Get-ChildItem $ndkRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName
}

# --- JDK: o Gradle 8.x nao compila script sobre JDK 25 -----------------------
# O JBR do Android Studio hoje e 25, e o Groovy do Gradle rejeita esse bytecode
# com "Unsupported class file major version 69". Por isso a escolha e por
# versao medida, e nao pelo primeiro JDK que aparecer.
function Get-JavaMajor($jdkPath) {
    $release = Join-Path $jdkPath 'release'
    if (-not (Test-Path $release)) { return 0 }
    $linha = Select-String -Path $release -Pattern '^JAVA_VERSION="([0-9]+)' -ErrorAction SilentlyContinue
    if (-not $linha) { return 0 }
    return [int]$linha.Matches[0].Groups[1].Value
}

$MAJOR_MIN = 17
$MAJOR_MAX = 24

$candidatos = @()
if ($env:PDFKITTY_JAVA_HOME) { $candidatos += $env:PDFKITTY_JAVA_HOME }
$jdksDir = Join-Path $env:USERPROFILE '.jdks'
if (Test-Path $jdksDir) { $candidatos += (Get-ChildItem $jdksDir -Directory | ForEach-Object { $_.FullName }) }
$candidatos += (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr')

$jdk = $null
$vistos = @()
foreach ($c in $candidatos) {
    if (-not (Test-Path (Join-Path $c 'bin\java.exe'))) { continue }
    $major = Get-JavaMajor $c
    $vistos += "  $c -> Java $major"
    if ($major -ge $MAJOR_MIN -and $major -le $MAJOR_MAX) { $jdk = $c; break }
}

if (-not $jdk) {
    $lista = $vistos -join "`n"
    Fail @"
Nenhum JDK compativel encontrado (preciso de Java $MAJOR_MIN a $MAJOR_MAX; o Gradle 8.x
rejeita bytecode de JDK 25 com 'Unsupported class file major version 69').

JDKs examinados:
$lista

Resolva baixando o Temurin 21 e extraindo em '$jdksDir', ou aponte PDFKITTY_JAVA_HOME
para um JDK compativel.
"@
}

# --- Ambiente ----------------------------------------------------------------
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:NDK_HOME = $ndk
$env:JAVA_HOME = $jdk
$env:PATH = "$env:PATH;$env:USERPROFILE\.cargo\bin;$env:APPDATA\npm;$sdk\platform-tools"

Write-Host "JDK : $jdk (Java $(Get-JavaMajor $jdk))"
Write-Host "SDK : $sdk"
Write-Host "NDK : $ndk"
Write-Host ""

Set-Location (Split-Path $PSScriptRoot -Parent)

# Pelo pnpm, e nao pelo atalho em node_modules/.bin, de proposito: o `android init` grava no
# BuildTask.kt gerado o executavel com que o CLI foi chamado, e o Gradle o reinvoca depois
# para compilar o Rust de cada ABI. Chamado pelo atalho, ele grava `node` e o Gradle falha
# com "Cannot find module ...\src-tauri\tauri" — erro que nao diz nada sobre a causa.
& pnpm tauri android @args
exit $LASTEXITCODE
