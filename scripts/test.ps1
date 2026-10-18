param([ValidateSet('Debug','Release')][string]$Configuration = 'Debug',
    [ValidateSet('Desktop','Core')][string]$Component = 'Desktop')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'native.ps1')
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'artifacts\build\native\CMakeCache.txt'))) { & (Join-Path $PSScriptRoot 'setup.ps1') -Component Core }
Invoke-ProjectTool -Tool cmake -Arguments @('--build', '--preset', $Configuration.ToLowerInvariant(), '--parallel', '4')
Invoke-ProjectTool -Tool ctest -Arguments @('--preset', $Configuration.ToLowerInvariant(), '--output-on-failure') -LogPath (Join-Path $projectRoot "artifacts\validation\tests-$Configuration.log")
if ($Component -eq 'Desktop') {
    . (Join-Path $PSScriptRoot 'desktop.ps1')
    Initialize-DesktopTools
    $env:N300_CORE_TEST_EXE = Join-Path $projectRoot "artifacts/package/$Configuration/n300.exe"
    Invoke-FrontendTool @('run', 'typecheck')
    Invoke-FrontendTool @('run', 'test:unit')
    Invoke-ProjectTool -Tool cargo -Arguments @('test', '--locked', '--lib') -WorkingDirectory $desktopNative
    $env:N300_TEST_CONFIGURATION = $Configuration
    Invoke-FrontendTool @('run', 'test:desktop')
}
