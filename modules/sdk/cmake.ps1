param(
    [Parameter(Mandatory=$true)][string]$Source,
    [ValidateSet('Install','Build')][string]$Action,
    [ValidateSet('Debug','Release')][string]$Configuration='Debug'
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../../scripts/native.ps1')
$hubRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$moduleLock=$null
if(-not $operationLock -or $DeskHubOperationRoot -ne $hubRoot){
    $null=New-Item -ItemType Directory -Force -Path (Join-Path $hubRoot '.local')
    try{$moduleLock=[IO.File]::Open((Join-Path $hubRoot '.local/operation.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}
    catch{throw 'Another DeskHub build is running.'}
}
try {
$logs=Join-Path $Source 'artifacts/validation'
Invoke-ProjectTool -Tool cmake -Arguments @('--preset','windows') -WorkingDirectory $Source -LogPath (Join-Path $logs 'configure.log')
if($Action -eq 'Build'){
    $preset=$Configuration.ToLowerInvariant()
    Invoke-ProjectTool -Tool cmake -Arguments @('--build','--preset',$preset,'--parallel','4') -WorkingDirectory $Source -LogPath (Join-Path $logs "build-$preset.log")
    Invoke-ProjectTool -Tool ctest -Arguments @('--preset',$preset) -WorkingDirectory $Source -LogPath (Join-Path $logs "test-$preset.log")
    Invoke-ProjectTool -Tool cmake -Arguments @('--install','artifacts/build/native','--config',$Configuration,'--prefix',"artifacts/package/$Configuration") -WorkingDirectory $Source
}
}finally{if($moduleLock){$moduleLock.Dispose()}}
