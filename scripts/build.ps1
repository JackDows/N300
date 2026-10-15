$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
$validation = Join-Path $projectRoot 'artifacts\validation'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Run scripts/setup.ps1 first' }
Push-Location $projectRoot
try {
    $env:PYTHONUTF8 = '1'
    & (Join-Path $PSScriptRoot 'test.ps1')
    & $pythonPath -m PyInstaller --noconfirm --clean --workpath artifacts/build --distpath artifacts/dist packaging/N300Desk.spec > "$validation\build.log" 2>&1
    if ($LASTEXITCODE -ne 0) { Get-Content -LiteralPath "$validation\build.log" -Tail 30; throw 'Build failed' }
    $reportPath = Join-Path $validation 'gui-packaged-smoke.json'
    $process = Start-Process -FilePath (Join-Path $projectRoot 'artifacts\dist\N300Desk\N300Desk.exe') -ArgumentList '--smoke-test', ('"' + $reportPath + '"') -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(15000)) { throw 'GUI startup check timed out' }
    if ($process.ExitCode -ne 0) { throw 'GUI startup check failed' }
    Get-Content -LiteralPath $reportPath
} finally { Pop-Location }
