$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
. (Join-Path $PSScriptRoot 'common.ps1')
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Run scripts/setup.ps1 first' }
$null = New-Item -ItemType Directory -Path (Join-Path $projectRoot 'artifacts\validation') -Force
Push-Location $projectRoot
try {
    $env:PYTHONUTF8 = '1'
    Invoke-ProjectPython -Arguments @('-m', 'unittest', 'discover', '-s', 'tests', '-v') -LogPath (Join-Path $projectRoot 'artifacts\validation\offline-tests.txt')
} finally { Pop-Location }
