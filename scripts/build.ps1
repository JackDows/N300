param([ValidateSet('Debug','Release')][string]$Configuration = 'Release')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
$validation = Join-Path $projectRoot 'artifacts\validation'
$distribution = Join-Path $projectRoot "artifacts\dist\$Configuration"
$previousConfiguration = $env:BUILD_CONFIGURATION
. (Join-Path $PSScriptRoot 'common.ps1')
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Run scripts/setup.ps1 first' }
Push-Location $projectRoot
try {
    $env:PYTHONUTF8 = '1'
    $env:BUILD_CONFIGURATION = $Configuration
    & (Join-Path $PSScriptRoot 'test.ps1')
    Write-Host "Building $Configuration..."
    Invoke-ProjectPython -Arguments @('-m', 'PyInstaller', '--noconfirm', '--workpath', "artifacts/build/$Configuration", '--distpath', "artifacts/dist/$Configuration", 'packaging/N300Desk.spec') -LogPath (Join-Path $validation "build-$Configuration.log") -Quiet
    $reportPath = Join-Path $validation "gui-$Configuration-smoke.json"
    $process = Start-Process -FilePath (Join-Path $distribution 'N300Desk\N300Desk.exe') -ArgumentList '--smoke-test', ('"' + $reportPath + '"') -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(15000)) { throw 'GUI startup check timed out' }
    if ($process.ExitCode -ne 0) { throw 'GUI startup check failed' }
    Get-Content -LiteralPath $reportPath
    Write-Host "Ready: $distribution\N300Desk\N300Desk.exe"
} finally { $env:BUILD_CONFIGURATION = $previousConfiguration; Pop-Location }
