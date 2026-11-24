#Requires -Version 5.1
<#
.SYNOPSIS
  Запуск dev-сервера фронтенда на 127.0.0.1:5173.

.DESCRIPTION
  Если нет frontend\node_modules — сначала npm install. Затем npm run dev.
  Запросы /api проксируются на http://127.0.0.1:8010 (vite.config.ts), поэтому
  backend должен быть запущен отдельно.

.EXAMPLE
  .\deploy\start-frontend.ps1
#>
[CmdletBinding()]
param(
    [int]$Port = 5173
)

$ErrorActionPreference = 'Stop'

# Русский текст в консоли без кракозябр.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$projectRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $projectRoot 'frontend'

if (-not (Test-Path -LiteralPath $frontendDir)) {
    throw "Нет каталога frontend: $frontendDir"
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
    throw 'Не найден npm.cmd. Поставь Node.js LTS: https://nodejs.org'
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listener) {
    $busyPids = ($listener | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
    Write-Host "Порт $Port уже занят (PID: $busyPids). Останови: .\deploy\stop.ps1" -ForegroundColor Yellow
    exit 1
}

Push-Location -LiteralPath $frontendDir
try {
    if (-not (Test-Path -LiteralPath (Join-Path $frontendDir 'node_modules'))) {
        Write-Host 'Первый запуск: npm install...' -ForegroundColor Cyan
        & $npm.Source install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install завершился с кодом $LASTEXITCODE"
        }
    }

    Write-Host ''
    Write-Host "Dev-фронт: http://127.0.0.1:$Port  (Ctrl+C — остановить)" -ForegroundColor Green
    Write-Host 'API уходит на http://127.0.0.1:8010 — backend должен быть запущен.'
    Write-Host ''
    & $npm.Source run dev -- --port $Port --strictPort
}
finally {
    Pop-Location
}
