#Requires -Version 5.1
<#
.SYNOPSIS
  Поднимает backend и frontend в двух отдельных окнах PowerShell.

.DESCRIPTION
  Открывает два окна: start-backend.ps1 и start-frontend.ps1.
  Если 8010 или 5173 уже занят — выходит с подсказкой про stop.ps1.

.EXAMPLE
  .\deploy\start-all.ps1
  .\deploy\start-all.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Low')]
param()

$ErrorActionPreference = 'Stop'

# Русский текст в консоли без кракозябр.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$startBackend = Join-Path $PSScriptRoot 'start-backend.ps1'
$startFrontend = Join-Path $PSScriptRoot 'start-frontend.ps1'

foreach ($path in @($startBackend, $startFrontend)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Нет скрипта: $path"
    }
}

foreach ($port in 8010, 5173) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if ($listener) {
        $busyPids = ($listener | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
        Write-Host "Порт $port уже занят (PID: $busyPids). Сначала: .\deploy\stop.ps1" -ForegroundColor Yellow
        exit 1
    }
}

$shell = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
$pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
if ($pwsh) {
    $shell = $pwsh.Source
}

$windows = @(
    @{ Path = $startBackend; Name = 'backend 8010' },
    @{ Path = $startFrontend; Name = 'frontend 5173' }
)

foreach ($window in $windows) {
    $argList = @('-NoExit', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', "`"$($window.Path)`"")
    if ($PSCmdlet.ShouldProcess($window.Name, 'Открыть окно PowerShell')) {
        Start-Process -FilePath $shell -ArgumentList $argList `
            -WorkingDirectory (Split-Path -Parent $PSScriptRoot) | Out-Null
        Write-Host "Открыто окно: $($window.Name)" -ForegroundColor Cyan
    }
}

Write-Host ''
Write-Host 'Dev-фронт (с горячей перезагрузкой): http://127.0.0.1:5173' -ForegroundColor Green
Write-Host 'API и проверка:                      http://127.0.0.1:8010/api/health'
Write-Host 'Всё через backend (если фронт собран): http://127.0.0.1:8010'
Write-Host ''
Write-Host 'Первый запуск backend идёт с uv sync — страница откроется не сразу (до минуты).'
Write-Host 'Остановить всё: .\deploy\stop.ps1'
