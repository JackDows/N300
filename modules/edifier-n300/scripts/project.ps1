# Stable project workflow contract. VS Code only calls this entry point.
# A project using another language implements these same actions with its own tools.
param(
    [Parameter(Mandatory=$true)][ValidateSet('Install','Build','Run','Test')][string]$Action,
    [ValidateSet('Debug','Release')][string]$Configuration = 'Debug',
    [ValidateSet('Desktop','Core')][string]$Component = 'Desktop',
    [switch]$Offline,
    [string[]]$CommandArguments = @('shell')
)
$ErrorActionPreference = 'Stop'
switch ($Action) {
    'Install' { & (Join-Path $PSScriptRoot 'setup.ps1') -Component $Component }
    'Build' { & (Join-Path $PSScriptRoot 'build.ps1') -Configuration $Configuration -Component $Component }
    'Run' { & (Join-Path $PSScriptRoot 'run.ps1') -Configuration $Configuration -Component $Component -Offline:$Offline -CommandArguments $CommandArguments }
    'Test' { & (Join-Path $PSScriptRoot 'test.ps1') -Configuration $Configuration -Component $Component }
}
