param([string]$SourceRoot = (Split-Path -Parent $PSScriptRoot))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $SourceRoot 'scripts\windows\Update-PaperDesk.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Updater PowerShell syntax is invalid.' }
# Load only the reviewed transport functions, not the installation portion of the updater.
foreach ($function in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]}, $true)) { . ([scriptblock]::Create($function.Extent.Text)) }
$revision = $env:GITHUB_SHA
if (-not $revision) { $revision = 'main' }
$url = "https://raw.githubusercontent.com/kangweihou522-cmyk/KW-/$revision/package.json"
$normal = Convert-PaperDeskContent (Invoke-PaperDeskWebRequest -Uri $url -TimeoutSec 30)
$expected = Get-Content -LiteralPath (Join-Path $SourceRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$normal.version -ne [string]$expected.version -or [string]$normal.name -ne [string]$expected.name) { throw 'Native Windows transport did not return the exact official application version.' }
Write-Host 'PASS real Windows HTTPS transport and JSON decoding against public repository'
function Invoke-WebRequest { param($UseBasicParsing, $Uri, $Headers, $TimeoutSec, $OutFile, $Proxy); throw 'Injected .NET transport failure to verify native curl fallback' }
try {
    $fallback = Convert-PaperDeskContent (Invoke-PaperDeskWebRequest -Uri $url -TimeoutSec 30)
    if ($fallback.version -ne $normal.version -or $fallback.name -ne $normal.name) { throw 'Native curl fallback returned an unexpected document.' }
    Write-Host 'PASS real Windows curl.exe HTTPS fallback after .NET transport failures'
} finally { Remove-Item Function:\Invoke-WebRequest -ErrorAction SilentlyContinue }
