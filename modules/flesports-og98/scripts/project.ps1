# Common workflow contract; implementation is local to this project.
param(
    [Parameter(Mandatory=$true)][ValidateSet('Install','Build','Run','Test')][string]$Action,
    [ValidateSet('Debug','Release')][string]$Configuration = 'Debug',
    [switch]$Offline,
    [string[]]$CommandArguments = @('shell')
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'native.ps1')
$preset = $Configuration.ToLowerInvariant()
$binary = Join-Path $projectRoot "artifacts/dist/$Configuration/og98.exe"
$buildPath = Join-Path $projectRoot 'artifacts/build/native'
$logs = Join-Path $projectRoot 'artifacts/logs'
function Configure-Project {
    Invoke-ProjectTool -Tool cmake -Arguments @('--preset','windows') -LogPath (Join-Path $logs 'configure.log')
}
function Build-Project {
    Configure-Project
    Invoke-ProjectTool -Tool cmake -Arguments @('--build','--preset',$preset,'--parallel') -LogPath (Join-Path $logs "build-$preset.log")
}
switch ($Action) {
    'Install' { Configure-Project }
    'Build' {
        Build-Project
        Invoke-ProjectTool -Tool ctest -Arguments @('--preset',$preset) -LogPath (Join-Path $logs "test-$preset.log")
        Invoke-ProjectTool -Tool cmake -Arguments @('--install',$buildPath,'--config',$Configuration,'--prefix',(Join-Path $projectRoot "artifacts/package/$Configuration"))
    }
    'Test' {
        Build-Project
        Invoke-ProjectTool -Tool ctest -Arguments @('--preset',$preset) -LogPath (Join-Path $logs "test-$preset.log")
    }
    'Run' {
        if (-not (Test-Path -LiteralPath $binary)) { Build-Project }
        $runArguments = @('--model','OG98','--log',(Join-Path $logs "core-$PID.jsonl"))
        if ($Offline) { $runArguments += '--offline' }
        & $binary @runArguments @CommandArguments
        if ($LASTEXITCODE -ne 0) { throw "OG98 exited with code $LASTEXITCODE" }
    }
}
