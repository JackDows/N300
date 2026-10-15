param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
. (Join-Path $PSScriptRoot 'common.ps1')
Push-Location $projectRoot
try {
    if (-not (Test-Path -LiteralPath $pythonPath)) {
        & $Python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 with tkinter is required' }
    }
    Invoke-ProjectPython -Arguments @('-c', "import sys, struct, tkinter; assert sys.platform == 'win32' and struct.calcsize('P') == 8 and sys.version_info[:2] == (3, 12), 'Use 64-bit Python 3.12 for the locked Windows build'")
    Write-Host 'Installing locked dependencies...'
    Invoke-ProjectPython -Arguments @('-m', 'pip', 'install', '-r', 'requirements-dev.lock.txt')
    Write-Host 'Installing the local application package...'
    Invoke-ProjectPython -Arguments @('-m', 'pip', 'install', '--no-build-isolation', '--no-deps', '-e', '.')
    Invoke-ProjectPython -Arguments @('-m', 'pip', 'check')
} finally { Pop-Location }
