param([ValidateSet('Debug','Release')][string]$Configuration = 'Debug')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'native.ps1')
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'artifacts\build\native\CMakeCache.txt'))) { & (Join-Path $PSScriptRoot 'setup.ps1') }
Invoke-ProjectTool -Tool cmake -Arguments @('--build', '--preset', $Configuration.ToLowerInvariant(), '--parallel', '4')
Invoke-ProjectTool -Tool ctest -Arguments @('--preset', $Configuration.ToLowerInvariant(), '--output-on-failure') -LogPath (Join-Path $projectRoot "artifacts\validation\tests-$Configuration.log")
