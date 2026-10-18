param(
    [ValidateSet('Debug','Release')][string]$Configuration = 'Debug',
    [switch]$Offline,
    [string[]]$CommandArguments = @('shell')
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot "artifacts\dist\$Configuration\n300.exe"
if (-not (Test-Path -LiteralPath $executable)) { throw "Build $Configuration first" }
$applicationArguments = @()
if ($Configuration -eq 'Debug') { $applicationArguments += '--debug' }
if ($Offline) { $applicationArguments += '--offline' }
$applicationArguments += $CommandArguments
. (Join-Path $PSScriptRoot 'native.ps1')
$options = @{FilePath=$executable; WorkingDirectory=$projectRoot; NoNewWindow=$true; PassThru=$true; Wait=$true}
if ($applicationArguments.Count) {
    $options.ArgumentList = ConvertTo-ProjectArguments $applicationArguments
}
$process = Start-Process @options
if ($process.ExitCode -ne 0) { throw "Application failed (exit $($process.ExitCode))" }
