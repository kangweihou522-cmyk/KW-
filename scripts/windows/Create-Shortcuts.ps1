param([string]$Root)
. "$PSScriptRoot\Common.ps1"
$Root = Get-PaperDeskRoot $Root
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$actions = @(
    @{ Name = 'PaperDesk'; Script = 'Start-PaperDesk.ps1'; Hotkey = 'CTRL+ALT+L' },
    @{ Name = 'PaperDesk - Update'; Script = 'Update-PaperDesk.ps1'; Hotkey = 'CTRL+ALT+U' },
    @{ Name = 'PaperDesk - Backup'; Script = 'Backup-PaperDesk.ps1'; Hotkey = '' },
    @{ Name = 'PaperDesk - Restore'; Script = 'Restore-PaperDesk.ps1'; Hotkey = '' },
    @{ Name = 'PaperDesk - Local Model'; Script = 'Setup-LocalModel.ps1'; Hotkey = '' }
)
foreach ($action in $actions) {
    $link = $shell.CreateShortcut((Join-Path $desktop ($action.Name + '.lnk')))
    $link.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $scriptPath = Join-Path $Root ('tools\' + $action.Script)
    # ExecutionPolicy applies only to this reviewed local helper invocation.
    $link.Arguments = '-NoProfile -NoExit -ExecutionPolicy Bypass -File "' + $scriptPath + '" -Root "' + $Root + '"'
    $link.WorkingDirectory = $Root
    $link.Hotkey = $action.Hotkey
    $link.Description = 'PaperDesk local workstation'
    $link.Save()
}
Write-Host 'Desktop shortcuts created. Start: Ctrl+Alt+L. Update: Ctrl+Alt+U.'
