# Desktop packaging belongs to DeskHub, independently of any device module.
. (Join-Path $PSScriptRoot 'cache.ps1')
function Initialize-DesktopTools {
    param([switch]$Install)
    Initialize-DeskHubRust -Install:$Install
    $env:CARGO_TARGET_DIR=Join-Path $projectRoot 'artifacts/build/desktop'
    $buildTemp=Join-Path $projectRoot '.local/desktop-tmp'
    $null=New-Item -ItemType Directory -Force -Path $buildTemp
    $env:TEMP=$buildTemp
    $env:TMP=$buildTemp
    $env:npm_config_cache=Join-Path (Get-DeskHubCacheRoot) 'npm-cache'
}
function Invoke-DesktopTool {
    param([string[]]$Arguments,[string]$LogPath)
    $npmDirectory=Split-Path -Parent (Get-Command npm.cmd -ErrorAction Stop).Source
    Invoke-ProjectTool -Tool node -Arguments (@((Join-Path $npmDirectory 'node_modules/npm/bin/npm-cli.js'))+$Arguments) -WorkingDirectory (Join-Path $projectRoot 'apps/desktop') -LogPath $LogPath
}
function Install-Desktop {
    Initialize-DesktopTools -Install
    Invoke-DesktopTool @('ci','--no-audit','--no-fund')
    Invoke-ProjectTool -Tool cargo -Arguments @('fetch','--locked','--manifest-path','apps/desktop/src-tauri/Cargo.toml','--target','x86_64-pc-windows-msvc')
}
function Build-Desktop {
    param([string]$Configuration,[string]$VersionOverride)
    Initialize-DesktopTools
    $resources=@{}
    $moduleRoot=Join-Path $projectRoot "artifacts/package/$Configuration/modules"
    Get-ChildItem -LiteralPath $moduleRoot -File -Recurse | ForEach-Object {
        $relative=$_.FullName.Substring($moduleRoot.Length+1).Replace('\','/')
        $resources[$_.FullName]="modules/$relative"
    }
    $bundle=@{resources=$resources}
    $key=Join-Path $projectRoot '.local/keys/deskhub-updater.key'
    if($Configuration -eq 'Release') {
        if(-not $env:TAURI_SIGNING_PRIVATE_KEY -and $env:TAURI_SIGNING_PRIVATE_KEY_PATH){$env:TAURI_SIGNING_PRIVATE_KEY=$env:TAURI_SIGNING_PRIVATE_KEY_PATH}
        if(-not $env:TAURI_SIGNING_PRIVATE_KEY -and (Test-Path -LiteralPath $key)){$env:TAURI_SIGNING_PRIVATE_KEY=$key}
        $bundle.createUpdaterArtifacts=[bool]$env:TAURI_SIGNING_PRIVATE_KEY
    }
    $config=@{bundle=$bundle}
    if($VersionOverride){$config.version=$VersionOverride}
    $configPath=Join-Path $projectRoot ".local/desktop-$Configuration.json"
    [IO.File]::WriteAllText($configPath,($config|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    $arguments=@('run','tauri','--','build','--config',$configPath)
    if($Configuration -eq 'Debug'){$arguments+=@('--debug','--no-bundle')}
    $arguments+=@('--','--locked')
    Invoke-DesktopTool $arguments -LogPath (Join-Path $projectRoot "artifacts/validation/desktop-build-$Configuration.log")
    $cargoOutput=Join-Path $env:CARGO_TARGET_DIR $Configuration.ToLowerInvariant()
    $output=Join-Path $projectRoot "artifacts/desktop/$Configuration"
    $null=New-Item -ItemType Directory -Force -Path (Join-Path $output 'modules')
    Copy-Item -LiteralPath (Join-Path $cargoOutput 'DeskHub.exe') -Destination $output -Force
    Get-ChildItem -LiteralPath $moduleRoot | Copy-Item -Destination (Join-Path $output 'modules') -Recurse -Force
    if($Configuration -eq 'Release') {
        $version=if($VersionOverride){$VersionOverride}else{(Get-Content -LiteralPath (Join-Path $projectRoot 'apps/desktop/src-tauri/tauri.conf.json') -Raw -Encoding UTF8|ConvertFrom-Json).version}
        $installers=Join-Path $projectRoot "artifacts/releases/$version"
        $null=New-Item -ItemType Directory -Force -Path $installers
        $filename="DeskHub_${version}_x64-setup.exe"
        Copy-Item -LiteralPath (Join-Path $cargoOutput "bundle/nsis/$filename") -Destination $installers -Force
        if($env:TAURI_SIGNING_PRIVATE_KEY){
            Copy-Item -LiteralPath (Join-Path $cargoOutput "bundle/nsis/$filename.sig") -Destination $installers -Force
            Invoke-ProjectTool -Tool node -Arguments @((Join-Path $projectRoot 'scripts/package-release.mjs'),'app','--version',$version)
        }
    }
    Write-Host "Desktop ready: $output\DeskHub.exe"
}
function Test-Desktop {
    param([string]$Configuration)
    Initialize-DesktopTools
    Invoke-DesktopTool @('run','typecheck')
    Invoke-DesktopTool @('run','test:unit')
    $cargoArgs=@('test','--locked','--manifest-path','apps/desktop/src-tauri/Cargo.toml','--lib')
    if($Configuration -eq 'Release'){$cargoArgs+='--release'}
    Invoke-ProjectTool -Tool cargo -Arguments $cargoArgs -LogPath (Join-Path $projectRoot "artifacts/validation/desktop-rust-$Configuration.log")
    $env:DESKHUB_TEST_CONFIGURATION=$Configuration
    Invoke-DesktopTool @('run','test:desktop') -LogPath (Join-Path $projectRoot "artifacts/validation/desktop-regression-$Configuration.log")
}
