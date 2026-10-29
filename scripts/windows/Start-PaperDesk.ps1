param([string]$Root)
. "$PSScriptRoot\Common.ps1"
$Root = Get-PaperDeskRoot $Root
$exe = Join-Path $Root 'app\PaperDesk.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "PaperDesk is not installed: $exe" }
$env:PAPERDESK_HOME = $Root
$env:OLLAMA_MODELS = Join-Path $Root 'models'
$env:OLLAMA_HOST = '127.0.0.1:11434'
# Restart an installed local runtime after reboot; never pull models or use a
# cloud fallback during application startup.
$localWorkflow = $false
$configPath = Join-Path $Root 'data\.settings\paperquay.config.json'
if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    try { $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json; $localWorkflow = $config.settings.aiWorkflow -eq 'local' } catch { Write-Warning 'Cannot read reader config; Ollama will not start automatically.' }
}
if ($localWorkflow) {
    try { Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 | Out-Null }
    catch {
        $ollama = Get-Command ollama -ErrorAction SilentlyContinue
        if ($ollama) { Start-Process -FilePath $ollama.Source -ArgumentList 'serve' -WindowStyle Hidden }
        else { Write-Host 'Ollama is optional and is not installed.' }
    }
}
Start-Process -FilePath $exe -WorkingDirectory (Join-Path $Root 'app')
