param([string]$Root, [string]$Model = 'qwen3:4b')
. "$PSScriptRoot\Common.ps1"
$Root = Get-PaperDeskRoot $Root
Initialize-PaperDeskFolders $Root
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) { throw 'Install Ollama from https://ollama.com/ first. This script does not download or execute third-party installers.' }
if ($Model -notmatch '^[A-Za-z0-9][A-Za-z0-9_./:-]*$') { throw 'Invalid model name.' }
if ($Model -match '(?i)(?:[-:]cloud)(?:$|:)') { throw 'Hosted Ollama cloud models are disabled. Choose a downloaded local model, such as qwen3:4b.' }
$env:OLLAMA_MODELS = Join-Path $Root 'models'
$env:OLLAMA_HOST = '127.0.0.1:11434'
[Environment]::SetEnvironmentVariable('OLLAMA_MODELS', $env:OLLAMA_MODELS, 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_HOST', $env:OLLAMA_HOST, 'User')
if (Get-Process -Name 'ollama', 'ollama app' -ErrorAction SilentlyContinue) {
    throw 'Model directory has been set to D/root. Quit Ollama from its tray icon and stop its server, then run this shortcut again so the running server uses this directory.'
}
Start-Process -FilePath (Get-Command ollama).Source -ArgumentList 'serve' -WindowStyle Hidden
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
    try { Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 | Out-Null; $ready = $true; break } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $ready) { throw 'Local Ollama service did not become ready.' }
& ollama pull $Model
if ($LASTEXITCODE -ne 0) { throw 'Model download failed; no paid API fallback was attempted.' }
Write-Host "Local model ready: $Model. Model files: $env:OLLAMA_MODELS"
Write-Host 'The first download needs internet and several GB of disk. Inference thereafter is local and uses your hardware.'
