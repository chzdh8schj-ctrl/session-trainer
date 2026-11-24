#Requires -Version 5.1
<#
.SYNOPSIS
  Останавливает процессы, слушающие порты 8010 и 5173.

.DESCRIPTION
  Находит PID по таблице слушающих портов и убивает только их владельцев.
  Чужие процессы не трогает: если порт занят не тренажёром — это видно по имени процесса.
  Поддерживает -WhatIf (показать, что было бы остановлено).

.EXAMPLE
  .\deploy\stop.ps1
  .\deploy\stop.ps1 -WhatIf
  .\deploy\stop.ps1 -Ports 8010
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Low')]
param(
    [int[]]$Ports = @(8010, 5173)
)

$ErrorActionPreference = 'Stop'

# Русский текст в консоли без кракозябр.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Get-ListenPids {
    param([int]$Port)

    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        return @(
            Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique
        )
    }

    $found = @()
    $pattern = ":$Port\s+\S+\s+LISTENING\s+(\d+)\s*$"
    foreach ($line in (netstat -ano)) {
        if ($line -match $pattern) {
            $found += [int]$Matches[1]
        }
    }
    return @($found | Select-Object -Unique)
}

$stopped = 0

foreach ($port in $Ports) {
    $pids = Get-ListenPids -Port $port
    if (-not $pids -or $pids.Count -eq 0) {
        Write-Host "Порт $port`: никто не слушает."
        continue
    }

    foreach ($procId in $pids) {
        if ($procId -le 4) {
            continue
        }
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { 'неизвестный процесс' }

        if ($PSCmdlet.ShouldProcess("PID $procId ($name) на порту $port", 'Остановить')) {
            try {
                Stop-Process -Id $procId -Force -ErrorAction Stop
                Write-Host "Порт $port`: остановлен $name (PID $procId)." -ForegroundColor Green
                $stopped++
            }
            catch {
                Write-Host "Порт $port`: не удалось остановить PID $procId — $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
    }
}

Start-Sleep -Milliseconds 500

if ($WhatIfPreference) {
    Write-Host ''
    Write-Host '-WhatIf: ничего не остановлено.' -ForegroundColor Yellow
    return
}

$stillBusy = @()
foreach ($port in $Ports) {
    $left = Get-ListenPids -Port $port
    if ($left -and $left.Count -gt 0) {
        $stillBusy += "$port (PID: $($left -join ', '))"
    }
}

Write-Host ''
if ($stillBusy.Count -eq 0) {
    Write-Host 'Порты 8010 и 5173 свободны.' -ForegroundColor Green
    if ($stopped -gt 0) {
        Write-Host 'Окна PowerShell, где запускались серверы, можно закрыть.'
    }
}
else {
    Write-Host "Всё ещё занято: $($stillBusy -join '; ')" -ForegroundColor Yellow
    Write-Host 'Возможно, процесс запущен из-под другого пользователя — тогда нужны права администратора.'
    exit 1
}
