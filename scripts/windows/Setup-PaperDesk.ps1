param([string]$Root, [string]$AppDirectory, [switch]$BuildFromSource)
. "$PSScriptRoot\Common.ps1"
$Root = Get-PaperDeskRoot $Root
Assert-PaperDeskStopped $Root
Initialize-PaperDeskFolders $Root

$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not $BuildFromSource -and [string]::IsNullOrWhiteSpace($AppDirectory)) {
    if (Test-Path -LiteralPath (Join-Path $sourceRoot 'PaperDesk.exe') -PathType Leaf) {
        $AppDirectory = $sourceRoot
    }
}

if ($BuildFromSource) {
    if (-not (Test-Path (Join-Path $sourceRoot 'package-lock.json'))) { throw 'Use BuildFromSource from the complete source archive.' }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 LTS from https://nodejs.org/ first, then run this setup again.' }
    $major = [int]((& node --version).TrimStart('v').Split('.')[0])
    if ($major -lt 24) { throw 'Node.js 24 or later is required.' }
    Push-Location $sourceRoot
    try {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed; dependencies were not installed.' }
        & npm.cmd run package:windows
        if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed.' }
    } finally { Pop-Location }
    $AppDirectory = Join-Path $sourceRoot 'release\win-unpacked'
}

if ([string]::IsNullOrWhiteSpace($AppDirectory)) { throw 'Supply -AppDirectory pointing to the unpacked PaperDesk release, or use -BuildFromSource.' }
$AppDirectory = [IO.Path]::GetFullPath($AppDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $AppDirectory 'PaperDesk.exe') -PathType Leaf)) { throw 'PaperDesk.exe not found. An upstream PaperQuay build is not supported.' }
$target = Join-Path $Root 'app'
if ($AppDirectory.TrimEnd('\') -eq $target.TrimEnd('\')) { throw 'Source app folder must differ from the destination.' }
if ($AppDirectory.StartsWith($target.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or $target.StartsWith($AppDirectory.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Source and destination application folders must not overlap.' }
if (Test-Path -LiteralPath (Join-Path $target 'PaperDesk.exe')) {
    throw 'PaperDesk is already installed here. Use the checked update tool; setup will not overwrite an existing installation.'
}
if (Get-ChildItem -LiteralPath $target -Force | Select-Object -First 1) { throw 'The destination app folder is not empty. Setup will not overwrite existing files.' }
Copy-Item -Path (Join-Path $AppDirectory '*') -Destination $target -Recurse -Force
Copy-Item -Path (Join-Path $PSScriptRoot '*') -Destination (Join-Path $Root 'tools') -Recurse -Force
[Environment]::SetEnvironmentVariable('PAPERDESK_HOME', $Root, 'User')
$env:PAPERDESK_HOME = $Root
& (Join-Path $Root 'tools\Create-Shortcuts.ps1') -Root $Root
Write-Host "Installed PaperDesk to $target. Library and notes stay outside the app folder."
Write-Host 'Next: launch PaperDesk, install Ollama from https://ollama.com/ if needed, and use the local-model setup shortcut.'
