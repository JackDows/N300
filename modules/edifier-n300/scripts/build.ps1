param([ValidateSet('Debug','Release')][string]$Configuration = 'Release',
    [ValidateSet('Desktop','Core')][string]$Component = 'Desktop')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$validation = Join-Path $projectRoot 'artifacts\validation'
. (Join-Path $PSScriptRoot 'native.ps1')
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'artifacts\build\native\CMakeCache.txt'))) { & (Join-Path $PSScriptRoot 'setup.ps1') -Component Core }
Invoke-ProjectTool -Tool cmake -Arguments @('--build', '--preset', $Configuration.ToLowerInvariant(), '--parallel', '4') -LogPath (Join-Path $validation "build-$Configuration.log")
Invoke-ProjectTool -Tool ctest -Arguments @('--preset', $Configuration.ToLowerInvariant(), '--output-on-failure') -LogPath (Join-Path $validation "tests-$Configuration.log")
Invoke-ProjectTool -Tool cmake -Arguments @('--install', 'artifacts/build/native', '--config', $Configuration, '--prefix', "artifacts/package/$Configuration")
Write-Host "Ready: $projectRoot\artifacts\package\$Configuration\n300.exe and n300.dll"
if ($Component -eq 'Desktop') {
    . (Join-Path $PSScriptRoot 'desktop.ps1')
    Initialize-DesktopTools
    $env:N300_CORE_TEST_EXE = Join-Path $projectRoot "artifacts/package/$Configuration/n300.exe"
    if (-not (Test-Path -LiteralPath (Join-Path $desktopRoot 'node_modules/.package-lock.json'))) {
        throw 'Run Install first to restore frontend dependencies.'
    }
    Invoke-FrontendTool @('run', 'test:unit')
    Invoke-ProjectTool -Tool cargo -Arguments @('test', '--locked', '--lib') -WorkingDirectory $desktopNative
    $configPath = New-DesktopBuildConfig -Configuration $Configuration
    $buildArgs = @('run', 'tauri', '--', 'build', '--config', $configPath)
    if ($Configuration -eq 'Debug') { $buildArgs += @('--debug', '--no-bundle') }
    $buildArgs += @('--', '--locked')
    Write-Host "Building desktop application ($Configuration)..."
    Invoke-FrontendTool $buildArgs -LogPath (Join-Path $validation "desktop-build-$Configuration.log")
    Publish-DesktopPackage -Configuration $Configuration
}
