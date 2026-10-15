param(
    [ValidateSet('Debug','Release')][string]$Configuration = 'Debug',
    [Alias('Demo')][switch]$Offline
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot "artifacts\dist\$Configuration\N300Desk\N300Desk.exe"
if (-not (Test-Path -LiteralPath $executable)) { throw "Build $Configuration first" }
$applicationArguments = @()
if ($Configuration -eq 'Debug') { $applicationArguments += '--debug' }
if ($Offline) { $applicationArguments += '--demo' }
$options = @{FilePath=$executable; WorkingDirectory=(Split-Path -Parent $executable); NoNewWindow=$true; PassThru=$true; Wait=$true}
if ($applicationArguments.Count) { $options.ArgumentList = $applicationArguments }
$process = Start-Process @options
if ($process.ExitCode -ne 0) { throw "Application failed (exit $($process.ExitCode))" }
