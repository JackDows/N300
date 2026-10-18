param(
    [Parameter(Mandatory=$true)][ValidateSet('Install','Build','Run','Test','Clean')][string]$Action,
    [ValidateSet('Debug','Release')][string]$Configuration='Debug',
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]*$')][string]$Module='All',
    [switch]$Offline,
    [string[]]$CommandArguments=@('shell')
)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'native.ps1')
. (Join-Path $PSScriptRoot 'rust.ps1')
. (Join-Path $PSScriptRoot 'cache.ps1')
$knownModules=@(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'modules') -Directory | Where-Object {Test-Path -LiteralPath (Join-Path $_.FullName 'module.json')} | ForEach-Object {$_.Name})
if($Module -notin @('All','Backend') -and $Module -notin $knownModules){throw "Unknown module: $Module"}
$modules=if($Module -eq 'All'){$knownModules}elseif($Module -eq 'Backend'){@()}else{@($Module)}
$hostSelected=$Module -in @('All','Backend')
$preset=$Configuration.ToLowerInvariant()
$logs=Join-Path $projectRoot 'artifacts/validation'
function Invoke-ContractsTool([string[]]$Arguments) {
    $npmDirectory=Split-Path -Parent (Get-Command npm.cmd -ErrorAction Stop).Source
    $npmCli=Join-Path $npmDirectory 'node_modules/npm/bin/npm-cli.js'
    $env:npm_config_cache=Join-Path (Get-DeskHubCacheRoot) 'npm-cache'
    Invoke-ProjectTool -Tool node -Arguments (@($npmCli)+$Arguments)
}
function Configure-Modules {
    foreach($id in $modules){
        $source=Join-Path $projectRoot "modules/$id"
        & (Join-Path $source 'module.ps1') -Action Install -Configuration $Configuration
    }
}
function Publish-Module([string]$Id) {
    $source=Join-Path $projectRoot "modules/$Id"
    $manifest=Get-Content -Encoding UTF8 (Join-Path $source 'module.json') -Raw | ConvertFrom-Json
    $destination=Join-Path $projectRoot "artifacts/package/$Configuration/modules/$Id/$($manifest.version)"
    $null=New-Item -ItemType Directory -Force -Path $destination
    $build=Get-Content -Encoding UTF8 (Join-Path $source 'module.build.json') -Raw | ConvertFrom-Json
    $hashes=[ordered]@{}
    foreach($file in $build.files.PSObject.Properties){
        $name=$file.Name
        $inputFile=[IO.Path]::GetFullPath((Join-Path $source $file.Value.Replace('{Configuration}',$Configuration)))
        $outputFile=[IO.Path]::GetFullPath((Join-Path $destination $name))
        if(-not $inputFile.StartsWith([IO.Path]::GetFullPath($source)+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $outputFile.StartsWith([IO.Path]::GetFullPath($destination)+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Module packaging path escaped its directory'}
        $null=New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputFile)
        Copy-Item -LiteralPath $inputFile -Destination $outputFile -Force
        $hashes[$name]=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $destination $name)).Hash.ToLowerInvariant()
    }
    $manifest.files=$hashes
    [IO.File]::WriteAllText((Join-Path $destination 'module.json'),($manifest | ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
}
function Build-Project {
    foreach($id in $modules){
        $source=Join-Path $projectRoot "modules/$id"
        & (Join-Path $source 'module.ps1') -Action Build -Configuration $Configuration
        Publish-Module $id
    }
    if($hostSelected){
        Initialize-DeskHubRust
        $cargoArguments=@('build','--locked')
        if($Configuration -eq 'Release'){$cargoArguments+='--release'}
        Invoke-ProjectTool -Tool cargo -Arguments $cargoArguments -LogPath (Join-Path $logs "backend-build-$preset.log")
        $package=Join-Path $projectRoot "artifacts/package/$Configuration"
        $null=New-Item -ItemType Directory -Force -Path $package
        Copy-Item -LiteralPath (Join-Path $projectRoot "artifacts/build/backend/$preset/deskhub.exe") -Destination $package -Force
        foreach($directory in @('contracts','docs')){
            Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination $package -Recurse -Force
        }
        if(Test-Path -LiteralPath (Join-Path $projectRoot 'README.md')){Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $package -Force}
    }
}
if($Action -eq 'Clean'){
    & (Join-Path $PSScriptRoot 'maintenance.ps1') -Action Clean -Mode Build
    return
}
& (Join-Path $PSScriptRoot 'maintenance.ps1') -Action Clean -Mode Expired -Quiet
$operationLock=$null
$DeskHubOperationRoot=$projectRoot
if($Action -in @('Install','Build','Test')){
    $null=New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot '.local')
    try{$operationLock=[IO.File]::Open((Join-Path $projectRoot '.local/operation.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}
    catch{throw 'Another DeskHub build/maintenance task is running.'}
}
try { switch($Action){
    'Install'{
        Configure-Modules
        if($hostSelected){
            Initialize-DeskHubRust -Install
            Invoke-ProjectTool -Tool cargo -Arguments @('fetch','--locked','--target','x86_64-pc-windows-msvc')
            Invoke-ContractsTool @('ci','--no-audit','--no-fund')
            if((Test-Path -LiteralPath (Join-Path $projectRoot '.git')) -and $env:DESKHUB_SKIP_SCHEDULE -ne '1'){
                try{& (Join-Path $PSScriptRoot 'maintenance.ps1') -Action RegisterSchedule}
                catch{Write-Warning ('Daily cleanup task was not registered: '+$_.Exception.Message)}
            }
        }
    }
    'Build'{Build-Project}
    'Test'{
        Build-Project
        if($hostSelected){
            Invoke-ContractsTool @('run','check:types')
            Invoke-ContractsTool @('run','test:contracts')
            Invoke-ProjectTool -Tool powershell.exe -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $projectRoot 'tests/maintenance.ps1')) -LogPath (Join-Path $logs 'maintenance-tests.log')
            $cargoArguments=@('test','--locked')
            if($Configuration -eq 'Release'){$cargoArguments+='--release'}
            Invoke-ProjectTool -Tool cargo -Arguments $cargoArguments -LogPath (Join-Path $logs "backend-test-$preset.log")
            if($Module -eq 'All'){
                $fixtureArguments=@('build','--locked','--features','test-support','--bin','deskhub-test-module')
                if($Configuration -eq 'Release'){$fixtureArguments+='--release'}
                Invoke-ProjectTool -Tool cargo -Arguments $fixtureArguments
                $env:DESKHUB_CONFIGURATION=$Configuration
                Invoke-ProjectTool -Tool node -Arguments @('--test',(Join-Path $projectRoot 'tests/integration.mjs')) -LogPath (Join-Path $logs "integration-$preset.log")
            }
        }
    }
    'Run'{
        $binary=Join-Path $projectRoot "artifacts/package/$Configuration/deskhub.exe"
        if($hostSelected){
            if(-not(Test-Path -LiteralPath $binary)){throw 'Build this configuration first.'}
            $mode=if($Offline){'offline'}else{'online'}
            $arguments=@('--module-root',(Join-Path $projectRoot "artifacts/package/$Configuration/modules"),'--data-dir',(Join-Path $projectRoot "artifacts/data/$mode"))
            if($Offline){$arguments+='--offline'}
            & $binary @arguments @CommandArguments
        }else{
            $manifest=Get-Content -Encoding UTF8 (Join-Path $projectRoot "modules/$Module/module.json") -Raw | ConvertFrom-Json
            $binary=Join-Path $projectRoot "artifacts/package/$Configuration/modules/$Module/$($manifest.version)/$($manifest.executable)"
            if(-not(Test-Path -LiteralPath $binary)){throw 'Build this module first.'}
            if($Offline){& $binary --offline}else{& $binary}
        }
        if($LASTEXITCODE -ne 0){throw "DeskHub exited with code $LASTEXITCODE"}
    }
}
if($Action -in @('Install','Build','Test')){
    [IO.File]::WriteAllText((Join-Path $projectRoot '.local/last-build.txt'),[DateTime]::UtcNow.ToString('o'))
}
} finally {if($operationLock){$operationLock.Dispose()}}
