#Requires -Version 5.1
<#
.SYNOPSIS
  Запуск backend: uvicorn на 127.0.0.1:8010.

.DESCRIPTION
  Первый запуск: если нет backend\.env — копирует из .env.example и просит заполнить;
  если нет backend\.venv — делает uv sync. Дальше поднимает uvicorn из каталога backend.

.EXAMPLE
  .\deploy\start-backend.ps1
  .\deploy\start-backend.ps1 -Port 8011
#>
[CmdletBinding()]
param(
    [string]$Address = '127.0.0.1',
    [int]$Port = 8010
)

$ErrorActionPreference = 'Stop'

# Русский текст в консоли без кракозябр.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $projectRoot 'backend'
$envFile = Join-Path $backendDir '.env'
$envExample = Join-Path $backendDir '.env.example'
$venvDir = Join-Path $backendDir '.venv'

if (-not (Test-Path -LiteralPath $backendDir)) {
    throw "Нет каталога backend: $backendDir"
}

if (-not (Test-Path -LiteralPath $envFile)) {
    if (-not (Test-Path -LiteralPath $envExample)) {
        throw "Нет ни backend\.env, ни backend\.env.example"
    }
    Copy-Item -LiteralPath $envExample -Destination $envFile
    @(
        '',
        'Создан backend\.env из .env.example. Впиши в него:',
        '  SITE_PASSWORD    - пароль для входа на сайт',
        '  SESSION_SECRET   - случайная строка: python -c "import secrets; print(secrets.token_hex(32))"',
        '  DEEPSEEK_API_KEY - ключ DeepSeek; можно оставить пустым, тогда ИИ выключен',
        '',
        "Файл: $envFile",
        ''
    ) | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
}

$sitePassword = ''
$found = Select-String -Path $envFile -Pattern '^\s*SITE_PASSWORD\s*=\s*(.*)$' -Encoding UTF8 | Select-Object -First 1
if ($found) {
    $sitePassword = $found.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
}
if (-not $sitePassword) {
    Write-Host 'Внимание: SITE_PASSWORD пустой — на сайт не войти, пока не задашь пароль в backend\.env.' -ForegroundColor Yellow
    Write-Host ''
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw 'Не найден uv. Установка: powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listener) {
    $busyPids = ($listener | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
    Write-Host "Порт $Port уже занят (PID: $busyPids). Останови: .\deploy\stop.ps1" -ForegroundColor Yellow
    exit 1
}

Push-Location -LiteralPath $backendDir
try {
    if (-not (Test-Path -LiteralPath $venvDir)) {
        Write-Host 'Первый запуск: uv sync (зависимости в backend\.venv, это займёт минуту)...' -ForegroundColor Cyan
        & uv sync
        if ($LASTEXITCODE -ne 0) {
            throw "uv sync завершился с кодом $LASTEXITCODE"
        }
    }

    Write-Host ''
    Write-Host "Backend: http://${Address}:$Port  (Ctrl+C — остановить)" -ForegroundColor Green
    Write-Host ''
    & uv run uvicorn app.main:app --host $Address --port $Port
}
finally {
    Pop-Location
}
