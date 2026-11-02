param([string]$Root, [string]$Installer, [string]$ExpectedSha256)
. "$PSScriptRoot\Common.ps1"
$ProgressPreference = 'SilentlyContinue'
$Root = Get-PaperDeskRoot $Root
Assert-PaperDeskStopped $Root
$installTarget = Join-Path $Root 'app'
if (-not (Test-Path -LiteralPath (Join-Path $installTarget 'PaperDesk.exe') -PathType Leaf)) {
    throw '未找到已安装的 PaperDesk。请检查 -Root 指定的安装目录。'
}

function Get-InstalledPaperDeskVersion([string]$Directory) {
    $manifest = Join-Path $Directory 'app\resources\paperdesk-version.json'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return '' }
    $value = (Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).version
    if ([string]$value -notmatch '^\d+\.\d+\.\d+$') { throw '本机版本记录无效，未替换程序。' }
    return [string]$value
}

function Get-PaperDeskRelease {
    $api = 'https://api.github.com/repos/kangweihou522-cmyk/KW-/releases/latest'
    $headers = @{ 'User-Agent' = 'PaperDesk-Updater'; Accept = 'application/vnd.github+json' }
    Write-Host '正在检查 PaperDesk 官方更新...'
    try { $release = (Invoke-WebRequest -UseBasicParsing -Uri $api -Headers $headers -TimeoutSec 60).Content | ConvertFrom-Json }
    catch { throw '无法连接 PaperDesk 更新服务器。请检查网络，稍后再次点击桌面 PaperDesk - Update；不需要手动下载更新包。' }
    if ($release.draft -or $release.prerelease -or [string]$release.tag_name -notmatch '^paperdesk-v(\d+\.\d+\.\d+)$') { throw '更新频道或版本信息异常，未安装其他版本。' }
    $version = $Matches[1]
    $name = "PaperDesk-$version-Windows.zip"
    $packages = @($release.assets | Where-Object { $_.name -ceq $name })
    $checksums = @($release.assets | Where-Object { $_.name -ceq 'SHA256SUMS.txt' })
    if ($packages.Count -ne 1 -or $checksums.Count -ne 1) { throw '本次发行的更新文件尚未完整就绪，请稍后再次点击更新。' }
    $prefix = "https://github.com/kangweihou522-cmyk/KW-/releases/download/paperdesk-v$version/"
    if ([string]$packages[0].browser_download_url -cne ($prefix + $name) -or [string]$checksums[0].browser_download_url -cne ($prefix + 'SHA256SUMS.txt')) { throw '更新文件来源不属于 PaperDesk 官方仓库。' }
    if ([long]$packages[0].size -le 0 -or [long]$packages[0].size -gt 2147483648) { throw '更新文件大小异常。' }
    $digest = ''
    if ($null -ne $packages[0].PSObject.Properties['digest'] -and $packages[0].digest) {
        if ([string]$packages[0].digest -notmatch '^sha256:([a-fA-F0-9]{64})$') { throw '发行资产的 SHA256 格式异常。' }
        $digest = $Matches[1]
    }
    return @{ Version = $version; Name = $name; Url = ($prefix + $name); SumsUrl = ($prefix + 'SHA256SUMS.txt'); Bytes = [long]$packages[0].size; Digest = $digest }
}

$downloadDirectory = $null
$updateLock = $null
try {
    try { $updateLock = [IO.File]::Open((Join-Path $Root '.paperdesk-update.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch { throw '另一个更新任务正在运行，或安装目录不可写。请不要重复启动更新。' }
    if ([string]::IsNullOrWhiteSpace($Installer)) {
        # Windows PowerShell 5.1 must use TLS 1.2 for GitHub. Do not disable certificate verification.
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $release = Get-PaperDeskRelease
        $installedVersion = Get-InstalledPaperDeskVersion $Root
        if ($installedVersion -and ([version]$installedVersion -ge [version]$release.Version)) {
            Write-Host "当前已是最新版本 $installedVersion，无需更新。"
            return
        }
        Write-Host "发现 PaperDesk $($release.Version)。正在自动下载，随后校验、备份并安装..."
        $downloadDirectory = Join-Path $Root ('.update-download-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $downloadDirectory | Out-Null
        $sumFile = Join-Path $downloadDirectory 'SHA256SUMS.txt'
        $Installer = Join-Path $downloadDirectory $release.Name
        $headers = @{ 'User-Agent' = 'PaperDesk-Updater' }
        Invoke-WebRequest -UseBasicParsing -Uri $release.SumsUrl -Headers $headers -OutFile $sumFile -TimeoutSec 60
        if ((Get-Item -LiteralPath $sumFile).Length -gt 65536) { throw '更新校验文件过大。' }
        $sumPattern = '^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape($release.Name) + '$'
        $matchesForPackage = @(Get-Content -LiteralPath $sumFile -Encoding UTF8 | Where-Object { $_ -match $sumPattern })
        if ($matchesForPackage.Count -ne 1 -or $matchesForPackage[0] -notmatch $sumPattern) { throw '更新文件的 SHA256 记录缺失或不唯一。' }
        $ExpectedSha256 = $Matches[1]
        if ($release.Digest -and $release.Digest -ine $ExpectedSha256) { throw 'GitHub 资产摘要和校验清单不一致，已停止更新。' }
        Invoke-WebRequest -UseBasicParsing -Uri $release.Url -Headers $headers -OutFile $Installer -TimeoutSec 1800
        if ((Get-Item -LiteralPath $Installer).Length -ne $release.Bytes) { throw '更新文件下载不完整，原程序保持原样。请稍后再次点击更新。' }
    }
$Installer = [IO.Path]::GetFullPath($Installer)
if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw 'Update ZIP not found.' }
if ([IO.Path]::GetFileName($Installer) -notmatch '^PaperDesk.*\.zip$') { throw 'Select the PaperDesk Windows ZIP distributed for this independent edition.' }
if ($ExpectedSha256 -notmatch '^[0-9A-Fa-f]{64}$') { throw 'A valid expected SHA256 is required. No update was installed.' }
$actual = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash
if ($actual -ne $ExpectedSha256) { throw 'SHA256 mismatch. No update was installed.' }
Write-Host 'SHA256 校验已通过，正在验证并备份资料...' 
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
    foreach ($helper in @('Common.ps1', 'Create-Shortcuts.ps1', 'Update-PaperDesk.ps1', 'Start-PaperDesk.ps1')) {
        if (-not (Test-Path -LiteralPath (Join-Path $newTools $helper) -PathType Leaf)) { throw "The update is incomplete: $helper is missing." }
    }

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

} finally {
    if ($downloadDirectory -and (Test-Path -LiteralPath $downloadDirectory)) {
        Remove-Item -LiteralPath $downloadDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($null -ne $updateLock) { $updateLock.Dispose() }
}
