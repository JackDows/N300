$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'native.ps1')
Write-Host 'Checking C++ tools and installing the pinned project dependency...'
Invoke-ProjectTool -Tool cmake -Arguments @('--preset', 'windows') -LogPath (Join-Path $projectRoot 'artifacts\validation\install.log')
