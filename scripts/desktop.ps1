# Common desktop build paths. No dependency on a sibling checkout or machine-local absolute paths.
$projectRoot = Split-Path -Parent $PSScriptRoot
$desktopRoot = Join-Path $projectRoot 'desktop'
$desktopNative = Join-Path $desktopRoot 'src-tauri'
. (Join-Path $PSScriptRoot 'native.ps1')

function Initialize-DesktopTools {
    param([switch]$Install)
    $null = Get-Command node -ErrorAction Stop
    $nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
    if ($nodeMajor -lt 24) { throw 'Node.js 24 or newer is required.' }
    $env:npm_config_cache = Join-Path $projectRoot '.local/npm-cache'
    $env:CARGO_TARGET_DIR = Join-Path $projectRoot 'artifacts/build/desktop'
    # NSIS extraction uses rename; its temporary files and tools cache must share a drive.
    $buildTemp = Join-Path $projectRoot '.local/tmp'
    $null = New-Item -ItemType Directory -Path $buildTemp -Force
    $env:TEMP = $buildTemp
    $env:TMP = $buildTemp
    if (-not $env:CARGO_BUILD_JOBS) { $env:CARGO_BUILD_JOBS = '4' }
    $localCargo = Join-Path $projectRoot '.local/cargo/bin'
    if ((Test-Path -LiteralPath (Join-Path $localCargo 'cargo.exe')) -or -not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        $env:CARGO_HOME = Join-Path $projectRoot '.local/cargo'
        $env:RUSTUP_HOME = Join-Path $projectRoot '.local/rustup'
        if (-not (Test-Path -LiteralPath (Join-Path $localCargo 'cargo.exe'))) {
            if (-not $Install) { throw 'Run Install first to restore the Rust toolchain.' }
            Invoke-ProjectTool -Tool node -Arguments @((Join-Path $PSScriptRoot 'fetch-rustup.mjs'))
            $toolchain = (Get-Content (Join-Path $projectRoot 'rust-toolchain.toml') | Select-String 'channel = "([^"]+)"').Matches[0].Groups[1].Value
            Invoke-ProjectTool -Tool (Join-Path $projectRoot '.local/downloads/rustup-init-1.29.1.exe') -Arguments @('-y', '--no-modify-path', '--profile', 'minimal', '--default-host', 'x86_64-pc-windows-msvc', '--default-toolchain', $toolchain)
        }
        $env:PATH = $localCargo + [IO.Path]::PathSeparator + $env:PATH
    }
    $null = Get-Command cargo -ErrorAction Stop
}

function Invoke-FrontendTool {
    param([Parameter(Position=0)][string[]]$Arguments, [string]$LogPath)
    # Run npm's JS entry directly: .cmd cannot be passed to CreateProcess without a shell.
    $npmDir = Split-Path -Parent (Get-Command npm.cmd -ErrorAction Stop).Source
    $npmCli = Join-Path $npmDir 'node_modules/npm/bin/npm-cli.js'
    if (-not (Test-Path -LiteralPath $npmCli)) { throw "npm CLI not found: $npmCli" }
    Invoke-ProjectTool -Tool node -Arguments (@($npmCli) + $Arguments) -WorkingDirectory $desktopRoot -LogPath $LogPath
}

function New-DesktopBuildConfig {
    param([ValidateSet('Debug','Release')][string]$Configuration)
    $corePackage = Join-Path $projectRoot "artifacts/package/$Configuration"
    $resources = @{}
    foreach ($name in @('n300.exe','n300.dll')) {
        $source = Join-Path $corePackage $name
        if (-not (Test-Path -LiteralPath $source)) { throw "Build the $Configuration core first: $source" }
        $resources[$source] = "n300/$name"
    }
    $sourceLicense = Join-Path $corePackage 'licenses/nlohmann-json-LICENSE.MIT'
    $resources[$sourceLicense] = 'licenses/nlohmann-json-LICENSE.MIT'
    $configDir = Join-Path $projectRoot '.local/tauri'
    $null = New-Item -ItemType Directory -Path $configDir -Force
    $path = Join-Path $configDir "$Configuration.json"
    $bundle = @{resources=$resources}
    if ($Configuration -eq 'Release') {
        $localKey = Join-Path $projectRoot '.local/keys/n300-updater.key'
        if (-not $env:TAURI_SIGNING_PRIVATE_KEY -and (Test-Path -LiteralPath $localKey)) { $env:TAURI_SIGNING_PRIVATE_KEY = $localKey }
        $bundle.createUpdaterArtifacts = [bool]$env:TAURI_SIGNING_PRIVATE_KEY
        if (-not $bundle.createUpdaterArtifacts) { Write-Host 'No release signing key: building installer only. See docs/releases.md to publish updates.' }
    }
    [IO.File]::WriteAllText($path, (@{bundle=$bundle} | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    return $path
}

function Publish-DesktopPackage {
    param([ValidateSet('Debug','Release')][string]$Configuration)
    $cargoOutput = Join-Path $env:CARGO_TARGET_DIR $Configuration.ToLowerInvariant()
    $output = Join-Path $projectRoot "artifacts/desktop/$Configuration"
    $null = New-Item -ItemType Directory -Path (Join-Path $output 'n300') -Force
    Copy-Item -LiteralPath (Join-Path $cargoOutput 'N300Desk.exe') -Destination $output -Force
    foreach ($name in @('n300.exe','n300.dll')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot "artifacts/package/$Configuration/$name") -Destination (Join-Path $output 'n300') -Force
    }
    Copy-Item -LiteralPath (Join-Path $projectRoot "artifacts/package/$Configuration/licenses") -Destination $output -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/desktop.md') -Destination (Join-Path $output 'README.md') -Force
    if ($Configuration -eq 'Release') {
        $version = (Get-Content (Join-Path $desktopNative 'tauri.conf.json') -Raw | ConvertFrom-Json).version
        $installerName = "N300_${version}_x64-setup.exe"
        $installers = @(Get-Item -LiteralPath (Join-Path $cargoOutput "bundle/nsis/$installerName"))
        if ($env:TAURI_SIGNING_PRIVATE_KEY) {
            $installers += Get-Item -LiteralPath (Join-Path $cargoOutput "bundle/nsis/$installerName.sig")
        }
        if ($installers.Count -eq 0) { throw 'The Release installer was not produced.' }
        $installerDir = Join-Path $projectRoot 'artifacts/installers/Release'
        $null = New-Item -ItemType Directory -Path $installerDir -Force
        foreach ($installer in $installers) { Copy-Item -LiteralPath $installer.FullName -Destination $installerDir -Force }
        if ($env:TAURI_SIGNING_PRIVATE_KEY) {
            Invoke-ProjectTool -Tool node -Arguments @((Join-Path $projectRoot 'scripts/package-update.mjs'))
        } else {
            # Do not pair a new unsigned build with a signature from an older build.
            $stale = @(Join-Path $installerDir "$installerName.sig")
            foreach ($name in @($installerName,"$installerName.sig",'latest.json','SHA256SUMS')) {
                $stale += Join-Path $projectRoot "artifacts/updates/$version/$name"
            }
            foreach ($file in $stale) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force } }
        }
    }
    Write-Host "Desktop ready: $output\N300Desk.exe"
}
