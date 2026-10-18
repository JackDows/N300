param([switch]$Offline)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'desktop.ps1')
Initialize-DesktopTools
& (Join-Path $PSScriptRoot 'build.ps1') -Configuration Debug -Component Core
$env:N300_EXE = Join-Path $projectRoot 'artifacts/package/Debug/n300.exe'
$env:N300_OFFLINE = if ($Offline) { '1' } else { '0' }
Push-Location $desktopRoot
try {
    & npm.cmd run tauri -- dev
    if ($LASTEXITCODE -ne 0) { throw "Desktop dev exited with $LASTEXITCODE" }
} finally { Pop-Location }
