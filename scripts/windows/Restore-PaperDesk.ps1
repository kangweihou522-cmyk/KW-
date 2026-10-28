param([string]$Root, [string]$BackupDirectory)
. "$PSScriptRoot\Common.ps1"
$Root = Get-PaperDeskRoot $Root
Assert-PaperDeskStopped $Root
if ([string]::IsNullOrWhiteSpace($BackupDirectory)) { $BackupDirectory = Read-Host 'Backup folder containing manifest.json' }
$BackupDirectory = [IO.Path]::GetFullPath($BackupDirectory)
foreach ($name in @('data', 'library', 'notes', 'cache')) {
    $replacedFolder = [IO.Path]::GetFullPath((Join-Path $Root $name)).TrimEnd('\')
    if ($BackupDirectory.TrimEnd('\').Equals($replacedFolder, [StringComparison]::OrdinalIgnoreCase) -or $BackupDirectory.StartsWith($replacedFolder + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The backup must be outside the folders being restored.'
    }
}
$manifestPath = Join-Path $BackupDirectory 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Backup manifest missing.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.format -notin @('paperdesk-backup-v1', 'paperdesk-backup-v2')) { throw 'Unsupported backup format.' }
$folders = @('data', 'library', 'notes')
if ($manifest.format -eq 'paperdesk-backup-v2') { $folders += 'cache' }
else { Write-Host 'This older backup has no root cache folder. Current root cache is preserved; check older annotations after restore.' }
foreach ($name in $folders) {
    if (-not (Test-Path -LiteralPath (Join-Path $BackupDirectory $name) -PathType Container)) { throw "Backup is incomplete: $name folder missing." }
}
Initialize-PaperDeskFolders $Root
$beforeRestore = New-PaperDeskBackup $Root
foreach ($name in $folders) {
    $target = Join-Path $Root $name
    # The known target directory is replaced only after a recoverable backup.
    Remove-Item -LiteralPath $target -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $BackupDirectory $name) -Destination $Root -Recurse
}
Write-Host "Restore completed. Previous state is preserved in $beforeRestore"
Write-Host 'If restoring under a different drive/root, review file paths in library settings before opening papers.'
