#Requires -Version 5.1
<#
.SYNOPSIS
  Сборка фронтенда в frontend\dist — после этого FastAPI отдаёт сайт с порта 8010.

.DESCRIPTION
  Ставит зависимости (npm ci при наличии package-lock.json, иначе npm install),
  затем npm run build (tsc --noEmit + vite build).
  -Clean — принудительно переустановить зависимости через npm ci.

.EXAMPLE
  .\deploy\build-frontend.ps1
  .\deploy\build-frontend.ps1 -Clean
#>
[CmdletBinding()]
param(
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

# Русский текст в консоли без кракозябр.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$projectRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $projectRoot 'frontend'
$nodeModules = Join-Path $frontendDir 'node_modules'
$lockFile = Join-Path $frontendDir 'package-lock.json'
$distDir = Join-Path $frontendDir 'dist'

if (-not (Test-Path -LiteralPath $frontendDir)) {
    throw "Нет каталога frontend: $frontendDir"
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
    throw 'Не найден npm.cmd. Поставь Node.js LTS: https://nodejs.org'
}

$hasLock = Test-Path -LiteralPath $lockFile

Push-Location -LiteralPath $frontendDir
try {
    $needInstall = $Clean -or (-not (Test-Path -LiteralPath $nodeModules))
    if ($needInstall) {
        if ($hasLock) {
            Write-Host 'Установка зависимостей: npm ci...' -ForegroundColor Cyan
            & $npm.Source ci
        }
        else {
            Write-Host 'Установка зависимостей: npm install...' -ForegroundColor Cyan
            & $npm.Source install
        }
        if ($LASTEXITCODE -ne 0) {
            throw "Установка зависимостей завершилась с кодом $LASTEXITCODE"
        }
    }

    Write-Host 'Сборка: npm run build...' -ForegroundColor Cyan
    & $npm.Source run build
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build завершился с кодом $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath (Join-Path $distDir 'index.html'))) {
    throw "Сборка прошла, но нет $distDir\index.html"
}

Write-Host ''
Write-Host "Готово: $distDir" -ForegroundColor Green
Write-Host 'Сайт отдаётся backend-ом: http://127.0.0.1:8010'
Write-Host 'Если backend уже был запущен — перезапусти его: dist монтируется при старте.'
