param([string]$Root, [string]$Installer, [string]$ExpectedSha256)
. "$PSScriptRoot\Common.ps1"
$Root = Get-PaperDeskRoot $Root
Assert-PaperDeskStopped $Root
if ([string]::IsNullOrWhiteSpace($Installer)) {
    Write-Host 'No automatic remote release check is configured. Obtain the PaperDesk Windows ZIP and its SHA256 from the trusted release publisher.'
    Write-Host 'Project releases: https://github.com/kangweihou522-cmyk/KW-/releases'
    $Installer = Read-Host 'Full path to PaperDesk*.zip, or press Enter to cancel'
}
if ([string]::IsNullOrWhiteSpace($Installer)) { Write-Host 'Update cancelled; no files changed.'; return }
$Installer = [IO.Path]::GetFullPath($Installer)
if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw 'Update ZIP not found.' }
if ([IO.Path]::GetFileName($Installer) -notmatch '^PaperDesk.*\.zip$') { throw 'Select the PaperDesk Windows ZIP distributed for this independent edition.' }
if ([string]::IsNullOrWhiteSpace($ExpectedSha256)) { $ExpectedSha256 = Read-Host 'Expected SHA256 from the trusted publisher (64 hex characters)' }
if ($ExpectedSha256 -notmatch '^[0-9A-Fa-f]{64}$') { throw 'A valid expected SHA256 is required. No update was installed.' }
$actual = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash
if ($actual -ne $ExpectedSha256) { throw 'SHA256 mismatch. No update was installed.' }
$installTarget = Join-Path $Root 'app'
if (-not (Test-Path -LiteralPath (Join-Path $installTarget 'PaperDesk.exe') -PathType Leaf)) { throw 'An existing PaperDesk app was not found. Use Setup-PaperDesk for first installation.' }

Initialize-PaperDeskFolders $Root
$token = [Guid]::NewGuid().ToString('N')
# Staging is outside all backed-up/restored data folders.
$staging = Join-Path $Root ('.update-' + $token)
$oldApplication = Join-Path $Root ('backups\app-before-update-' + $token)
$oldTools = Join-Path $Root ('backups\tools-before-update-' + $token)
$toolsTarget = Join-Path $Root 'tools'
$appMoved = $false
$toolsMoved = $false
$backup = ''
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($Installer)
    try {
        $stagingPrefix = [IO.Path]::GetFullPath($staging).TrimEnd('\') + '\'
        $seenEntries = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $archive.Entries) {
            $entryName = $entry.FullName.Replace('/', '\')
            if ([string]::IsNullOrWhiteSpace($entryName) -or [IO.Path]::IsPathRooted($entryName) -or $entryName -match '[:\x00]' -or $entryName.Split('\') -contains '..') {
                throw 'Unsafe ZIP entry: absolute paths, parent traversal and alternate data streams are not accepted.'
            }
            foreach ($segment in $entryName.Split('\')) {
                if ($segment -eq '.' -or $segment -match '[. ]$') { throw 'Ambiguous ZIP path components are not accepted.' }
            }
            $canonical = [IO.Path]::GetFullPath((Join-Path $staging $entryName))
            if (-not $canonical.StartsWith($stagingPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'ZIP entry escapes the staging directory.' }
            if (-not $seenEntries.Add($canonical.TrimEnd('\'))) { throw 'Duplicate or case-colliding ZIP entries are not accepted.' }
            $unixType = ($entry.ExternalAttributes -shr 16) -band 61440
            if ($unixType -eq 40960) { throw 'Symbolic-link ZIP entries are not accepted.' }
        }
        # Extract the same open archive only after every entry passed validation.
        foreach ($entry in $archive.Entries) {
            $entryName = $entry.FullName.Replace('/', '\')
            $canonical = [IO.Path]::GetFullPath((Join-Path $staging $entryName))
            if ($entryName.EndsWith('\')) {
                [IO.Directory]::CreateDirectory($canonical) | Out-Null
            } else {
                [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($canonical)) | Out-Null
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $canonical, $false)
            }
        }
    } finally { $archive.Dispose() }
    $executables = @(Get-ChildItem -LiteralPath $staging -Filter 'PaperDesk.exe' -File -Recurse)
    if ($executables.Count -ne 1) { throw 'The ZIP must contain exactly one PaperDesk.exe.' }
    $candidate = $executables[0].Directory.FullName
    if (-not (Test-Path -LiteralPath (Join-Path $candidate 'resources\app.asar') -PathType Leaf)) { throw 'The ZIP is incomplete: resources\app.asar is missing.' }
    $newTools = Join-Path $candidate 'resources\windows-tools'
    if (-not (Test-Path -LiteralPath $newTools -PathType Container)) { throw 'The ZIP is incomplete: resources\windows-tools is missing.' }

    # Validate all archive entries and layout before touching the installed app.
    $backup = New-PaperDeskBackup $Root
    Move-Item -LiteralPath $installTarget -Destination $oldApplication
    $appMoved = $true
    New-Item -ItemType Directory -Path $installTarget | Out-Null
    Get-ChildItem -LiteralPath $candidate -Force | Copy-Item -Destination $installTarget -Recurse -Force
    if (-not (Test-Path -LiteralPath (Join-Path $installTarget 'PaperDesk.exe') -PathType Leaf)) { throw 'The copied application is incomplete.' }

    # Rebuild links with the previously installed reviewed helper, before copying
    # replacement helpers. No executable or script from the ZIP runs to install it.
    & (Join-Path $PSScriptRoot 'Create-Shortcuts.ps1') -Root $Root
    if (Test-Path -LiteralPath $toolsTarget -PathType Container) {
        Move-Item -LiteralPath $toolsTarget -Destination $oldTools
        $toolsMoved = $true
    }
    New-Item -ItemType Directory -Path $toolsTarget | Out-Null
    Get-ChildItem -LiteralPath $newTools -Force | Copy-Item -Destination $toolsTarget -Recurse -Force
    Write-Host "Update completed. Data backup: $backup"
    Write-Host "Previous application retained in: $oldApplication"
} catch {
    $failure = $_.Exception.Message
    $rollbackErrors = @()
    if ($toolsMoved) {
        try {
            if (Test-Path -LiteralPath $toolsTarget) { Remove-Item -LiteralPath $toolsTarget -Recurse -Force }
            Move-Item -LiteralPath $oldTools -Destination $toolsTarget
        } catch { $rollbackErrors += $_.Exception.Message }
    }
    if ($appMoved) {
        try {
            if (Test-Path -LiteralPath $installTarget) { Remove-Item -LiteralPath $installTarget -Recurse -Force }
            Move-Item -LiteralPath $oldApplication -Destination $installTarget
        } catch { $rollbackErrors += $_.Exception.Message }
    }
    $details = if ($rollbackErrors.Count) { 'Rollback needs attention: ' + ($rollbackErrors -join '; ') } else { 'The original application was preserved/restored.' }
    throw "Update failed: $failure $details Data backup: $backup Previous app location: $oldApplication"
} finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
}
