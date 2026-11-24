<#
.SYNOPSIS
    Импортирует seed/demo-data.json в учебный тренажёр через /api/import.

.DESCRIPTION
    Логинится по паролю (кука st_session), затем заливает предметы, билеты и части.
    Кириллица идёт без перекодировок: файл читается как UTF-8, тело запроса — байты UTF-8,
    массив subjects берётся из файла как есть, без ConvertFrom-Json/ConvertTo-Json.
    После импорта названия предметов сверяются с файлом и проверяются на двойную кодировку.

.EXAMPLE
    .\seed\import.ps1 -Password "мойпароль"

.EXAMPLE
    .\seed\import.ps1 -BaseUrl http://127.0.0.1:8010 -Password "мойпароль" -Replace
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://127.0.0.1:8010',
    [Parameter(Mandatory = $true)][string]$Password,
    [switch]$Replace
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
$dataPath = Join-Path $PSScriptRoot 'demo-data.json'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function New-Mark([int]$a, [int]$b) { return ([string][char]$a) + ([string][char]$b) }

# Пары, которые получаются, если UTF-8 прочитать как cp1251 ("Финансы" -> "Р¤РёРЅР°РЅСЃС‹").
$mojibakeMarkers = @(
    (New-Mark 0x0420 0x00B0), # а
    (New-Mark 0x0420 0x00B5), # е
    (New-Mark 0x0420 0x0451), # и
    (New-Mark 0x0420 0x0455), # о
    (New-Mark 0x0420 0x00A4), # Ф
    (New-Mark 0x0420 0x0405), # н
    (New-Mark 0x0420 0x0406), # в
    (New-Mark 0x0420 0x0491), # д
    (New-Mark 0x0420 0x0454), # к
    (New-Mark 0x0421 0x0403), # с
    (New-Mark 0x0421 0x0402), # р
    (New-Mark 0x0421 0x201A), # т
    (New-Mark 0x0421 0x2039)  # ы
)

function Stop-WithError([string]$message, [string]$hint) {
    Write-Host ''
    Write-Host 'ОШИБКА' -ForegroundColor Red
    Write-Host "  $message"
    if ($hint) { Write-Host "  $hint" }
    exit 1
}

function Test-Mojibake([string]$text) {
    $found = @()
    foreach ($m in $mojibakeMarkers) {
        if ($text.Contains($m)) { $found += $m }
    }
    return $found
}

function Test-Cyrillic([string]$text) { return [bool]($text -match '[\u0400-\u04FF]') }

# Вырезает из JSON-текста сырое значение члена (массив/объект), не разбирая и не пересобирая его.
function Get-RawJsonMember([string]$text, [string]$name) {
    $marker = '"' + $name + '"'
    $at = $text.IndexOf($marker)
    if ($at -lt 0) { return $null }
    $i = $text.IndexOf(':', $at + $marker.Length)
    if ($i -lt 0) { return $null }
    $i++
    while ($i -lt $text.Length -and [char]::IsWhiteSpace($text[$i])) { $i++ }
    if ($i -ge $text.Length) { return $null }

    $open = $text[$i]
    if ($open -eq '[') { $close = ']' } elseif ($open -eq '{') { $close = '}' } else { return $null }

    $depth = 0
    $inString = $false
    $escaped = $false
    for ($j = $i; $j -lt $text.Length; $j++) {
        $c = $text[$j]
        if ($inString) {
            if ($escaped) { $escaped = $false }
            elseif ($c -eq '\') { $escaped = $true }
            elseif ($c -eq '"') { $inString = $false }
            continue
        }
        if ($c -eq '"') { $inString = $true; continue }
        if ($c -eq $open) { $depth++ }
        elseif ($c -eq $close) {
            $depth--
            if ($depth -eq 0) { return $text.Substring($i, $j - $i + 1) }
        }
    }
    return $null
}

# Ответ читаем байтами и декодируем сами: PS 5.1 иначе считает JSON без charset за ISO-8859-1.
function Read-Utf8Json($response) {
    if ($null -ne $response.RawContentStream) {
        $bytes = $response.RawContentStream.ToArray()
    } else {
        $bytes = $utf8.GetBytes([string]$response.Content)
    }
    $parsed = ([System.Text.Encoding]::UTF8.GetString($bytes)) | ConvertFrom-Json
    # ConvertFrom-Json в PS 5.1 отдаёт массив одним объектом: @() вокруг такого результата
    # даёт список из одного элемента, поэтому разворачиваем вручную.
    if ($parsed -is [System.Array]) { foreach ($item in $parsed) { $item } } else { $parsed }
}

function Invoke-JsonPost([string]$uri, [string]$jsonText, $session) {
    $params = @{
        Uri             = $uri
        Method          = 'Post'
        ContentType     = 'application/json; charset=utf-8'
        Body            = [System.Text.Encoding]::UTF8.GetBytes($jsonText)
        TimeoutSec      = 120
        UseBasicParsing = $true
    }
    if ($null -ne $session) { $params['WebSession'] = $session }
    Invoke-WebRequest @params
}

# --- 1. Файл данных ---------------------------------------------------------

if (-not (Test-Path -LiteralPath $dataPath)) {
    Stop-WithError "Не найден файл данных: $dataPath" 'Положи demo-data.json рядом со скриптом.'
}

# Строго UTF-8: в PS 5.1 Get-Content без -Encoding читает ANSI и портит кириллицу.
$text = [System.IO.File]::ReadAllText($dataPath, [System.Text.Encoding]::UTF8)
if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }

if ($text.IndexOf([char]0xFFFD) -ge 0) {
    Stop-WithError 'demo-data.json прочитан с потерей символов (U+FFFD): файл не в UTF-8 или повреждён.' 'Пересохрани файл в UTF-8 без BOM.'
}

$subjectsRaw = Get-RawJsonMember $text 'subjects'
if (-not $subjectsRaw) {
    Stop-WithError 'В demo-data.json нет массива subjects.' 'Ожидается {"version":1,"exported_at":...,"subjects":[...]}.'
}

try {
    $data = $text | ConvertFrom-Json
} catch {
    Stop-WithError "demo-data.json не разбирается как JSON: $($_.Exception.Message)"
}

$expectedNames = @($data.subjects | ForEach-Object { ([string]$_.name).Trim() })
if ($expectedNames.Count -eq 0) { Stop-WithError 'В demo-data.json нет ни одного предмета.' }

$badFile = @()
foreach ($n in $expectedNames) {
    $marks = @(Test-Mojibake $n)
    $excerpt = if ($n.Length -gt 40) { $n.Substring(0, 40) + '...' } else { $n }
    if ($marks.Count -gt 0) { $badFile += "'$excerpt' - двойная кодировка, маркеров: $($marks.Count)" }
    elseif (-not (Test-Cyrillic $n)) { $badFile += "'$excerpt' - нет кириллицы" }
}
if ($badFile.Count -gt 0) {
    Stop-WithError ('demo-data.json выглядит двояко закодированным: ' + ($badFile -join '; ')) 'Файл должен быть UTF-8. Ничего не отправлено, база не изменена.'
}

$replaceLiteral = if ($Replace) { 'true' } else { 'false' }
# Склейка строк: массив subjects идёт из файла как есть, объекты не пересобираются.
$importBody = '{"replace":' + $replaceLiteral + ',"subjects":' + $subjectsRaw + '}'

$preSendMarks = @(Test-Mojibake $importBody)
if ($preSendMarks.Count -gt 0) {
    Stop-WithError ('Тело запроса содержит признаки двойной кодировки: ' + ($preSendMarks -join ' ')) 'База не изменена.'
}

# --- 2. Backend -------------------------------------------------------------

$runHint = 'Проверь, что backend запущен: cd backend; uv run uvicorn app.main:app --host 127.0.0.1 --port 8010'

try {
    $health = Read-Utf8Json (Invoke-WebRequest -Uri "$BaseUrl/api/health" -UseBasicParsing -TimeoutSec 5)
} catch {
    Write-Host "Backend не отвечает на $BaseUrl/api/health" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)"
    Write-Host "  $runHint"
    exit 1
}
if (-not $health.ok) { Stop-WithError "Backend ответил неожиданно: $($health | ConvertTo-Json -Compress)" $runHint }
Write-Host "Backend на $BaseUrl отвечает." -ForegroundColor Green

# --- 3. Логин ---------------------------------------------------------------

$loginBody = '{"password":' + (ConvertTo-Json $Password -Compress) + '}'
$session = $null
try {
    [void](Invoke-WebRequest -Uri "$BaseUrl/api/auth/login" -Method Post -SessionVariable session `
            -ContentType 'application/json; charset=utf-8' `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($loginBody)) -UseBasicParsing -TimeoutSec 15)
} catch {
    $status = if ($null -ne $_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    Stop-WithError "Вход не выполнен (HTTP $status): $($_.Exception.Message)" 'Проверь пароль (SITE_PASSWORD в backend/.env).'
}
if ($null -eq $session -or $session.Cookies.Count -eq 0) {
    Stop-WithError 'Backend не выдал куку st_session.' 'Проверь ответ /api/auth/login.'
}
Write-Host 'Вход выполнен.' -ForegroundColor Green

# --- 4. Импорт --------------------------------------------------------------

try {
    $result = Read-Utf8Json (Invoke-JsonPost "$BaseUrl/api/import" $importBody $session)
} catch {
    $status = if ($null -ne $_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    $detail = ''
    if ($null -ne $_.ErrorDetails -and $_.ErrorDetails.Message) { $detail = " $($_.ErrorDetails.Message)" }
    Stop-WithError "Импорт отклонён (HTTP $status).$detail" $runHint
}

$mode = if ($Replace) { 'с заменой прежних данных' } else { 'добавлением к существующим' }
Write-Host ''
Write-Host "Импорт выполнен ($mode):" -ForegroundColor Green
Write-Host "  предметов создано: $($result.subjects_created)"
Write-Host "  билетов создано:   $($result.tickets_created)"
Write-Host "  частей создано:    $($result.parts_created)"

# --- 5. Самопроверка кодировки ---------------------------------------------

try {
    $serverSubjects = @(Read-Utf8Json (Invoke-WebRequest -Uri "$BaseUrl/api/subjects" -UseBasicParsing -WebSession $session -TimeoutSec 15))
} catch {
    Stop-WithError "Импорт прошёл, но GET /api/subjects не отвечает: $($_.Exception.Message)" 'Проверь базу вручную.'
}

$serverNames = @($serverSubjects | ForEach-Object { ([string]$_.name).Trim() })
$problems = @()
foreach ($n in $serverNames) {
    $marks = @(Test-Mojibake $n)
    $excerpt = if ($n.Length -gt 40) { $n.Substring(0, 40) + '...' } else { $n }
    if ($marks.Count -gt 0) { $problems += "двойная кодировка в '$excerpt', маркеров: $($marks.Count)" }
    elseif (-not (Test-Cyrillic $n)) { $problems += "нет кириллицы в '$excerpt'" }
}
$missing = @($expectedNames | Where-Object { $serverNames -notcontains $_ })
if ($missing.Count -gt 0) { $problems += ('в базе нет названий: ' + ($missing -join '; ')) }

Write-Host ''
Write-Host 'Предметы в базе после импорта:'
foreach ($n in $serverNames) { Write-Host "  - $n" }

if ($problems.Count -gt 0) {
    Write-Host ''
    Write-Host 'ОШИБКА КОДИРОВКИ' -ForegroundColor Red
    $problems | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Write-Host '  В базе испорченные названия. Запусти PowerShell 7 (pwsh) и повтори импорт' -ForegroundColor Red
    Write-Host '  с -Replace, чтобы заменить испорченные записи.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host 'Проверка кодировки пройдена: названия читаются, двойной кодировки нет.' -ForegroundColor Green
Write-Host "Дальше: открой http://127.0.0.1:5173 — там предметов из demo-data.json: $($expectedNames.Count)."
exit 0
