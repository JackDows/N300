param(
    [ValidateSet('Debug','Release')][string]$Configuration = 'Debug',
    [ValidateSet('Desktop','Core')][string]$Component = 'Desktop',
    [switch]$Offline,
    [string[]]$CommandArguments = @('shell')
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot "artifacts\dist\$Configuration\n300.exe"
if ($Component -eq 'Desktop') {
    $executable = Join-Path $projectRoot "artifacts\desktop\$Configuration\N300Desk.exe"
}
if (-not (Test-Path -LiteralPath $executable)) { throw "Build $Configuration first" }
$applicationArguments = @()
if ($Component -eq 'Core' -and $Configuration -eq 'Debug') { $applicationArguments += '--debug' }
if ($Offline) { $applicationArguments += '--offline' }
if ($Component -eq 'Core') { $applicationArguments += $CommandArguments }
. (Join-Path $PSScriptRoot 'native.ps1')
$options = @{FilePath=$executable; WorkingDirectory=$projectRoot; NoNewWindow=$true; PassThru=$true; Wait=$true}
if ($applicationArguments.Count) {
    $options.ArgumentList = ConvertTo-ProjectArguments $applicationArguments
}
$previousOffline = $env:N300_OFFLINE
$previousCore = $env:N300_EXE
try {
    if ($Component -eq 'Desktop') {
        $env:N300_OFFLINE = if ($Offline) { '1' } else { '0' }
        # Normal runs always use their packaged Debug/Release core, even after a hot-reload session.
        [Environment]::SetEnvironmentVariable('N300_EXE', $null, 'Process')
    }
    $process = Start-Process @options
    if ($process.ExitCode -ne 0) { throw "Application failed (exit $($process.ExitCode))" }
} finally {
    [Environment]::SetEnvironmentVariable('N300_OFFLINE', $previousOffline, 'Process')
    [Environment]::SetEnvironmentVariable('N300_EXE', $previousCore, 'Process')
}
