param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
Push-Location $projectRoot
try {
    if (-not (Test-Path -LiteralPath $pythonPath)) {
        & $Python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 or later with tkinter is required' }
    }
    & $pythonPath -c "import sys, struct, tkinter; assert sys.platform == 'win32' and struct.calcsize('P') == 8 and sys.version_info[:2] == (3, 12), 'Use 64-bit Python 3.12 for the locked Windows build'"
    if ($LASTEXITCODE -ne 0) { throw 'Use 64-bit Python 3.12 with tkinter' }
    & $pythonPath -m pip install -r requirements-dev.lock.txt
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
    & $pythonPath -m pip install --no-build-isolation --no-deps -e .
    if ($LASTEXITCODE -ne 0) { throw 'Editable package installation failed' }
    & $pythonPath -m pip check
    if ($LASTEXITCODE -ne 0) { throw 'Dependency consistency check failed' }
} finally { Pop-Location }
