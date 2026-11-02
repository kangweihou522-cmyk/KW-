param([string]$SourceRoot = (Split-Path -Parent $PSScriptRoot))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$testHome = Join-Path ([IO.Path]::GetTempPath()) ('PaperDesk-update-tests-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testHome | Out-Null
$passed = 0
function Assert-UpdateTest([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function New-UpdateFixture([string]$Name, [string]$InstalledVersion = '0.5.0', [string]$Version = '0.5.2', [string]$Mode = 'ok') {
    $base = Join-Path $testHome $Name
    $root = Join-Path $base 'PaperDesk test'
    foreach ($directory in @('app\resources', 'tools', 'data', 'library', 'notes', 'cache', 'models')) { New-Item -ItemType Directory -Path (Join-Path $root $directory) -Force | Out-Null }
    Set-Content -LiteralPath (Join-Path $root 'app\PaperDesk.exe') -Value 'ORIGINAL PROGRAM' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $root 'app\resources\app.asar') -Value 'ORIGINAL ASAR' -Encoding UTF8
    if ($InstalledVersion) { @{version = $InstalledVersion} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'app\resources\paperdesk-version.json') -Encoding UTF8 }
    foreach ($directory in @('data','library','notes','cache','models')) { Set-Content -LiteralPath (Join-Path $root "$directory\keep.txt") -Value "KEEP $directory" -Encoding UTF8 }
    Copy-Item -LiteralPath (Join-Path $SourceRoot 'scripts\windows\Common.ps1') -Destination (Join-Path $root 'tools\Common.ps1')
    Copy-Item -LiteralPath (Join-Path $SourceRoot 'scripts\windows\Update-PaperDesk.ps1') -Destination (Join-Path $root 'tools\Update-PaperDesk.ps1')
    Set-Content -LiteralPath (Join-Path $root 'tools\Create-Shortcuts.ps1') -Value 'param($Root); Set-Content -LiteralPath (Join-Path $Root "reviewed-helper-used.txt") -Value "yes"' -Encoding UTF8
    $candidate = Join-Path $base 'candidate'
    New-Item -ItemType Directory -Path (Join-Path $candidate 'win-unpacked\resources\windows-tools') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $candidate 'win-unpacked\PaperDesk.exe') -Value 'NEW PROGRAM' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $candidate 'win-unpacked\resources\app.asar') -Value 'NEW ASAR' -Encoding UTF8
    @{version = $Version} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $candidate 'win-unpacked\resources\paperdesk-version.json') -Encoding UTF8
    foreach ($helper in @('Common.ps1','Update-PaperDesk.ps1','Start-PaperDesk.ps1')) { Copy-Item -LiteralPath (Join-Path $SourceRoot "scripts\windows\$helper") -Destination (Join-Path $candidate "win-unpacked\resources\windows-tools\$helper") }
    Set-Content -LiteralPath (Join-Path $candidate 'win-unpacked\resources\windows-tools\Create-Shortcuts.ps1') -Value 'throw "An unreviewed helper from the archive was executed"' -Encoding UTF8
    if ($Mode -eq 'incomplete') { Remove-Item -LiteralPath (Join-Path $candidate 'win-unpacked\resources\windows-tools\Start-PaperDesk.ps1') }
    $name = "PaperDesk-$Version-Windows.zip"
    $zip = Join-Path $base $name
    [IO.Compression.ZipFile]::CreateFromDirectory($candidate, $zip)
    if ($Mode -eq 'traversal') {
        $archive = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Update)
        try { $entry = $archive.CreateEntry('../escape.txt'); $writer = New-Object IO.StreamWriter($entry.Open()); $writer.Write('escape'); $writer.Dispose() } finally { $archive.Dispose() }
    }
    $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    $prefix = "https://github.com/kangweihou522-cmyk/KW-/releases/download/paperdesk-v$Version/"
    $digest = if ($Mode -eq 'digest') { '0' * 64 } else { $hash }
    $metadata = @{ draft = $false; prerelease = $false; tag_name = "paperdesk-v$Version"; assets = @(@{ name = $name; browser_download_url = ($prefix + $name); size = (Get-Item -LiteralPath $zip).Length; digest = "sha256:$digest" }, @{name = 'SHA256SUMS.txt'; browser_download_url = ($prefix + 'SHA256SUMS.txt')}) }
    if ($Mode -eq 'foreign') { $metadata.assets[0].browser_download_url = 'https://example.invalid/foreign.zip' }
    $feed = @{ schema = 1; product = 'PaperDesk'; repository = 'kangweihou522-cmyk/KW-'; version = $Version; asset = @{ name = $name; url = $metadata.assets[0].browser_download_url; bytes = $metadata.assets[0].size; sha256 = $digest } }
    return @{ Feed = $feed; Root = $root; Zip = $zip; Hash = $hash; Name = $name; Mode = $Mode; Metadata = $metadata; Calls = (New-Object 'System.Collections.Generic.List[string]'); FailMove = ($Mode -eq 'rollback') }
}
function global:Invoke-WebRequest {
    param([string]$Uri, $Headers, [string]$OutFile, [int]$TimeoutSec, [switch]$UseBasicParsing, [string]$Proxy)
    $fixture = $global:PaperDeskUpdateFixture
    $fixture.Calls.Add($Uri)
    if ($fixture.Mode -eq 'network') { throw 'fixture DNS resolution failed' }
    if ($fixture.Mode -eq 'retry' -and $fixture.Calls.Count -eq 1) { throw 'fixture temporary failure' }
    if ($fixture.Mode -eq 'proxy') { Assert-UpdateTest ($Proxy -eq 'http://127.0.0.1:7890') 'Configured HTTPS proxy was not used' }
    if ($Uri.StartsWith('https://raw.githubusercontent.com/kangweihou522-cmyk/KW-/paperdesk-updates/windows.json')) { if ($fixture.Mode -eq 'api-fallback') { throw 'fixture feed unavailable' }; if ($fixture.Mode -eq 'byte-content') { return @{Content = [Text.Encoding]::UTF8.GetBytes(($fixture.Feed | ConvertTo-Json -Depth 8))} }; return @{Content = ($fixture.Feed | ConvertTo-Json -Depth 8)} }
    if ($Uri -eq 'https://api.github.com/repos/kangweihou522-cmyk/KW-/releases/latest') { return @{Content = ($fixture.Metadata | ConvertTo-Json -Depth 8)} }
    if ($Uri.EndsWith('/SHA256SUMS.txt')) { Set-Content -LiteralPath $OutFile -Value ($fixture.Hash + '  ' + $fixture.Name) -Encoding ASCII; return }
    if ($Uri.EndsWith('/' + $fixture.Name)) {
        Microsoft.PowerShell.Management\Copy-Item -LiteralPath $fixture.Zip -Destination $OutFile
        if ($fixture.Mode -eq 'corrupt') { $stream = [IO.File]::OpenWrite($OutFile); try { $stream.WriteByte(0) } finally { $stream.Dispose() } }
        return
    }
    throw "Unexpected remote URL: $Uri"
}
function global:Get-Command {
    [CmdletBinding()]
    param([string]$Name, [string]$CommandType)
    if ($Name -eq 'curl.exe') { return $null }
    return Microsoft.PowerShell.Core\Get-Command @PSBoundParameters
}
function global:Move-Item {
    param([string]$LiteralPath, [string]$Destination)
    $fixture = $global:PaperDeskUpdateFixture
    if ($fixture.FailMove -and $LiteralPath -eq (Join-Path $fixture.Root 'tools')) { $fixture.FailMove = $false; throw 'Simulated failure after program copy' }
    Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
}
function Invoke-FixtureUpdate($Fixture) {
    $global:PaperDeskUpdateFixture = $Fixture
    & (Join-Path $Fixture.Root 'tools\Update-PaperDesk.ps1') -Root $Fixture.Root
}
function Assert-OriginalPreserved($Fixture) {
    Assert-UpdateTest ((Get-Content -LiteralPath (Join-Path $Fixture.Root 'app\PaperDesk.exe') -Raw).Contains('ORIGINAL PROGRAM')) 'Original application was lost'
    foreach ($directory in @('data','library','notes','cache','models')) { Assert-UpdateTest ((Get-Content -LiteralPath (Join-Path $Fixture.Root "$directory\keep.txt") -Raw).Contains("KEEP $directory")) "$directory was modified" }
    Assert-UpdateTest (@(Get-ChildItem -LiteralPath $Fixture.Root -Directory | Where-Object {$_.Name.StartsWith('.update-')}).Count -eq 0) 'Transient updater files were not removed'
}
try {
    $fixture = New-UpdateFixture 'automatic'
    Invoke-FixtureUpdate $fixture
    Assert-UpdateTest ((Get-Content -LiteralPath (Join-Path $fixture.Root 'app\PaperDesk.exe') -Raw).Contains('NEW PROGRAM')) 'Automatic download did not install the new version'
    Assert-UpdateTest (Test-Path -LiteralPath (Join-Path $fixture.Root 'reviewed-helper-used.txt')) 'The previously installed helper was not used'
    foreach ($directory in @('data','library','notes','cache','models')) { Assert-UpdateTest ((Get-Content -LiteralPath (Join-Path $fixture.Root "$directory\keep.txt") -Raw).Contains("KEEP $directory")) "$directory was modified" }
    Assert-UpdateTest (@(Get-ChildItem -LiteralPath (Join-Path $fixture.Root 'backups') -Directory | Where-Object { $_.Name.StartsWith('app-before-update-') }).Count -eq 1) 'Old program was not retained'
    Assert-UpdateTest (@(Get-ChildItem -LiteralPath (Join-Path $fixture.Root 'backups') -Directory | Where-Object { $_.Name.StartsWith('PaperDesk-') }).Count -eq 1) 'Data backup was not created'
    $fixture.Calls.Clear()
    Invoke-FixtureUpdate $fixture
    Assert-UpdateTest ($fixture.Calls.Count -eq 1) 'Latest version unnecessarily downloaded another update'
    $passed++; Write-Host 'PASS automatic download, SHA256, backup, data/model retention, helper renewal, latest-version no-op'

    $fixture = New-UpdateFixture 'downgrade' '0.6.0'
    Invoke-FixtureUpdate $fixture
    Assert-OriginalPreserved $fixture
    Assert-UpdateTest ($fixture.Calls.Count -eq 1) 'An older version was downloaded'
    $passed++; Write-Host 'PASS no downgrade'

    foreach ($mode in @('network','digest','foreign','corrupt','traversal','incomplete','rollback')) {
        $fixture = New-UpdateFixture $mode '0.5.0' '0.5.2' $mode
        $failed = $false
        try { Invoke-FixtureUpdate $fixture } catch { $failed = $true; if ($mode -eq 'network') { Assert-UpdateTest ($_.Exception.Message.Contains('fixture DNS resolution failed')) 'Original network failure was hidden' }; Write-Host "Expected rejection ($mode): $($_.Exception.Message)" }
        Assert-UpdateTest $failed "Invalid update was accepted: $mode"
        Assert-OriginalPreserved $fixture
        if ($mode -in @('foreign','network')) { Assert-UpdateTest (@($fixture.Calls | Where-Object { $_.EndsWith('.zip') }).Count -eq 0) 'Invalid metadata allowed a program download' }
        $passed++; Write-Host "PASS $mode preserves existing program and data"
    }
    $fixture = New-UpdateFixture 'old-channel' '0.4.1' '0.5.0'
    $failed = $false
    try { Invoke-FixtureUpdate $fixture } catch { $failed = $true }
    Assert-UpdateTest $failed 'An obsolete manual-update release was accepted'
    Assert-UpdateTest (@($fixture.Calls | Where-Object { $_.EndsWith('.zip') }).Count -eq 0) 'Obsolete channel downloaded an old updater'
    Assert-OriginalPreserved $fixture
    $passed++; Write-Host 'PASS obsolete update channel cannot restore the old manual updater'

    $fixture = New-UpdateFixture 'concurrent'
    $lock = [IO.File]::Open((Join-Path $fixture.Root '.paperdesk-update.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        $failed = $false
        try { Invoke-FixtureUpdate $fixture } catch { $failed = $true }
        Assert-UpdateTest $failed 'Concurrent updater was allowed to modify the installation'
        Assert-UpdateTest ($fixture.Calls.Count -eq 0) 'Concurrent updater started a download'
    } finally { $lock.Dispose() }
    Assert-OriginalPreserved $fixture
    $passed++; Write-Host 'PASS concurrent updater cannot download or modify the installation'

    foreach ($mode in @('retry', 'api-fallback', 'proxy', 'byte-content')) {
        $fixture = New-UpdateFixture $mode '0.5.0' '0.5.2' $mode
        $previousProxy = $env:HTTPS_PROXY
        try { if ($mode -eq 'proxy') { $env:HTTPS_PROXY = 'http://127.0.0.1:7890' }; Invoke-FixtureUpdate $fixture }
        finally { if ($null -eq $previousProxy) { Remove-Item Env:\HTTPS_PROXY -ErrorAction SilentlyContinue } else { $env:HTTPS_PROXY = $previousProxy } }
        Assert-UpdateTest ((Get-Content -LiteralPath (Join-Path $fixture.Root 'app\PaperDesk.exe') -Raw).Contains('NEW PROGRAM')) "Network fallback failed: $mode"
        if ($mode -eq 'api-fallback') { Assert-UpdateTest ($fixture.Calls.Contains('https://api.github.com/repos/kangweihou522-cmyk/KW-/releases/latest')) 'API fallback was not tried' }
        $passed++; Write-Host "PASS $mode network recovery"
    }
    $fixture = New-UpdateFixture 'legacy' ''
    Invoke-FixtureUpdate $fixture
    Assert-UpdateTest ((Get-Content -LiteralPath (Join-Path $fixture.Root 'app\resources\paperdesk-version.json') -Raw | ConvertFrom-Json).version -eq '0.5.2') 'Legacy installation without a version manifest was not migrated'
    $passed++; Write-Host 'PASS legacy installation migrates to automatic update'
    Write-Host "PASS $passed Windows PowerShell updater integration scenarios"
} finally {
    Remove-Item Function:\Invoke-WebRequest -ErrorAction SilentlyContinue
    Remove-Item Function:\Move-Item -ErrorAction SilentlyContinue
    Remove-Item Function:\Get-Command -ErrorAction SilentlyContinue
    Remove-Variable PaperDeskUpdateFixture -Scope Global -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $testHome) { Remove-Item -LiteralPath $testHome -Recurse -Force }
}
