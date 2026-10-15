param([switch]$Demo)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Run scripts/setup.ps1 first' }
if ($Demo) { & $pythonPath -m n300_desk --demo } else { & $pythonPath -m n300_desk }
exit $LASTEXITCODE
