#Requires -Version 5.1
<#
.SYNOPSIS
  Резервная копия базы: backend\data\app.db -> backups\app-YYYYMMDD-HHmmss.db

.DESCRIPTION
  Если есть backend\.venv, копия снимается через sqlite3 backup API — это безопасно
  при работающем сервере и с WAL. Иначе файл копируется напрямую вместе с -wal и -shm.
  Каталог backups создаётся сам. Старые копии не удаляются.

.EXAMPLE
  .\deploy\backup.ps1
  .\deploy\backup.ps1 -BackupDir D:\backups\trainer
#>
[CmdletBinding()]
param(
    [string]$BackupDir
)

$ErrorActionPreference = 'Stop'

# Русский текст в консоли без кракозябр.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$projectRoot = Split-Path -Parent $PSScriptRoot
$dbPath = Join-Path $projectRoot 'backend\data\app.db'
if (-not $BackupDir) {
    $BackupDir = Join-Path $projectRoot 'backups'
}

if (-not (Test-Path -LiteralPath $dbPath)) {
    Write-Host "База не найдена: $dbPath"
    Write-Host 'Она появится после первого запуска backend.'
    exit 1
}

if (-not (Test-Path -LiteralPath $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dest = Join-Path $BackupDir "app-$stamp.db"
$done = $false

$venvPython = Join-Path $projectRoot 'backend\.venv\Scripts\python.exe'
if (Test-Path -LiteralPath $venvPython) {
    $code = 'import sqlite3, sys; src = sqlite3.connect(sys.argv[1]); dst = sqlite3.connect(sys.argv[2]); src.backup(dst); dst.close(); src.close()'
    & $venvPython -c $code $dbPath $dest
    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $dest)) {
        $done = $true
    }
}

if (-not $done) {
    Copy-Item -LiteralPath $dbPath -Destination $dest -Force
    foreach ($suffix in '-wal', '-shm') {
        if (Test-Path -LiteralPath ($dbPath + $suffix)) {
            Copy-Item -LiteralPath ($dbPath + $suffix) -Destination ($dest + $suffix) -Force
        }
    }
    Write-Host 'backend\.venv не найден — файл базы скопирован напрямую.' -ForegroundColor Yellow
    Write-Host 'Если backend работает, на время копирования лучше его остановить.' -ForegroundColor Yellow
}

$size = (Get-Item -LiteralPath $dest).Length
$copies = @(Get-ChildItem -LiteralPath $BackupDir -Filter 'app-*.db' -File).Count

Write-Host ''
Write-Host "Резервная копия: $dest" -ForegroundColor Green
Write-Host ("Размер: {0:N0} КБ. Всего копий: {1}" -f ($size / 1KB), $copies)
Write-Host ''
Write-Host 'Полный снимок в JSON: сайт -> /admin -> Экспорт (файл сохрани отдельно, например на диск или в облако).'
