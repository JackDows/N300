param([ValidateSet('Debug','Release')][string]$Configuration = 'Release')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$validation = Join-Path $projectRoot 'artifacts\validation'
. (Join-Path $PSScriptRoot 'native.ps1')
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'artifacts\build\native\CMakeCache.txt'))) { & (Join-Path $PSScriptRoot 'setup.ps1') }
Invoke-ProjectTool -Tool cmake -Arguments @('--build', '--preset', $Configuration.ToLowerInvariant(), '--parallel', '4') -LogPath (Join-Path $validation "build-$Configuration.log")
Invoke-ProjectTool -Tool ctest -Arguments @('--preset', $Configuration.ToLowerInvariant(), '--output-on-failure') -LogPath (Join-Path $validation "tests-$Configuration.log")
Invoke-ProjectTool -Tool cmake -Arguments @('--install', 'artifacts/build/native', '--config', $Configuration, '--prefix', "artifacts/package/$Configuration")
Write-Host "Ready: $projectRoot\artifacts\package\$Configuration\n300.exe and n300.dll"
