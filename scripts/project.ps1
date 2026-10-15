# Stable project workflow contract. VS Code only calls this entry point.
# A project using another language implements these same actions with its own tools.
param(
    [Parameter(Mandatory=$true)][ValidateSet('Install','Build','Run','Test')][string]$Action,
    [ValidateSet('Debug','Release')][string]$Configuration = 'Debug',
    [switch]$Offline,
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
switch ($Action) {
    'Install' { & (Join-Path $PSScriptRoot 'setup.ps1') -Python $Python }
    'Build' { & (Join-Path $PSScriptRoot 'build.ps1') -Configuration $Configuration }
    'Run' { & (Join-Path $PSScriptRoot 'run.ps1') -Configuration $Configuration -Offline:$Offline }
    'Test' { & (Join-Path $PSScriptRoot 'test.ps1') }
}
