param([string]$Root)
. "$PSScriptRoot\Common.ps1"
$Root = Get-PaperDeskRoot $Root
Initialize-PaperDeskFolders $Root
$backup = New-PaperDeskBackup $Root
Write-Host "Backup completed: $backup"
Write-Host 'Only managed library files are included. PDFs kept at external paths must be backed up separately.'
