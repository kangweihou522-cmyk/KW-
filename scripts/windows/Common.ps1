Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PaperDeskRoot([string]$Root) {
    if ([string]::IsNullOrWhiteSpace($Root)) { $Root = $env:PAPERDESK_HOME }
    if ([string]::IsNullOrWhiteSpace($Root)) {
        if (-not (Test-Path -LiteralPath 'D:\' -PathType Container)) {
            throw 'D drive not found. Choose a folder with -Root E:\PaperDesk or set PAPERDESK_HOME. No C-drive fallback is used.'
        }
        $Root = 'D:\PaperDesk'
    }
    if (-not [IO.Path]::IsPathRooted($Root)) { throw 'Root must be an absolute folder path.' }
    $fullRoot = [IO.Path]::GetFullPath($Root)
    if ($fullRoot.TrimEnd('\') -eq [IO.Path]::GetPathRoot($fullRoot).TrimEnd('\')) {
        throw 'Choose an application folder such as D:\PaperDesk, not the drive root.'
    }
    return $fullRoot.TrimEnd('\')
}

function Assert-PaperDeskStopped([string]$Root) {
    # The app name is unique to this fork. Do not stop unrelated programs.
    if (Get-Process -Name 'PaperDesk' -ErrorAction SilentlyContinue) {
        throw 'Close PaperDesk before backup, restore, installation or updating to avoid copying an active SQLite database.'
    }
}

function Initialize-PaperDeskFolders([string]$Root) {
    foreach ($name in @('app', 'data', 'library', 'notes', 'models', 'cache', 'backups', 'tools')) {
        New-Item -ItemType Directory -Path (Join-Path $Root $name) -Force | Out-Null
    }
}

function New-PaperDeskBackup([string]$Root) {
    Assert-PaperDeskStopped $Root
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $destination = Join-Path $Root "backups\PaperDesk-$timestamp"
    New-Item -ItemType Directory -Path $destination -ErrorAction Stop | Out-Null
    # An ordinary directory avoids PowerShell Compress-Archive's 2GB limits.
    foreach ($name in @('data', 'library', 'notes', 'cache')) {
        $source = Join-Path $Root $name
        if (Test-Path -LiteralPath $source) {
            Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
        }
        if (-not (Test-Path -LiteralPath (Join-Path $destination $name) -PathType Container)) {
            New-Item -ItemType Directory -Path (Join-Path $destination $name) | Out-Null
        }
    }
    $manifest = @{ format = 'paperdesk-backup-v2'; createdAt = (Get-Date).ToString('o'); sourceRoot = $Root; folders = @('data', 'library', 'notes', 'cache') }
    $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'manifest.json') -Encoding UTF8
    return $destination
}
