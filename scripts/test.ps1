$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Run scripts/setup.ps1 first' }
$null = New-Item -ItemType Directory -Path (Join-Path $projectRoot 'artifacts\validation') -Force
Push-Location $projectRoot
try {
    $env:PYTHONUTF8 = '1'
    & $pythonPath -m unittest discover -s tests -v 2>&1 | Tee-Object -FilePath artifacts/validation/offline-tests.txt
    if ($LASTEXITCODE -ne 0) { throw 'Offline tests failed' }
} finally { Pop-Location }
