param([ValidateSet('Desktop','Core')][string]$Component = 'Desktop')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'native.ps1')
Write-Host 'Checking C++ tools and installing the pinned project dependency...'
Invoke-ProjectTool -Tool cmake -Arguments @('--preset', 'windows') -LogPath (Join-Path $projectRoot 'artifacts\validation\install.log')
if ($Component -eq 'Desktop') {
    . (Join-Path $PSScriptRoot 'desktop.ps1')
    Initialize-DesktopTools -Install
    Write-Host 'Installing frontend dependencies from package-lock.json...'
    Invoke-FrontendTool @('ci', '--no-audit', '--no-fund')
    Write-Host 'Fetching Rust dependencies from Cargo.lock...'
    Invoke-ProjectTool -Tool cargo -Arguments @('fetch', '--locked', '--target', 'x86_64-pc-windows-msvc') -WorkingDirectory $desktopNative
}
