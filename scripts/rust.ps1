function Initialize-DeskHubRust {
    param([switch]$Install,[string]$SourceRoot=$projectRoot)
    $env:CARGO_TARGET_DIR = Join-Path $SourceRoot 'artifacts/build/backend'
    $env:CARGO_BUILD_JOBS = '4'
    . (Join-Path $PSScriptRoot 'cache.ps1')
    $cacheRoot=Get-DeskHubCacheRoot
    $toolchain = (Get-Content -Encoding UTF8 (Join-Path $SourceRoot 'rust-toolchain.toml') | Select-String 'channel = "([^"]+)"').Matches[0].Groups[1].Value
    $toolchainBin=Join-Path $cacheRoot "rustup/toolchains/$toolchain-x86_64-pc-windows-msvc/bin"
    if ((Test-Path -LiteralPath (Join-Path $toolchainBin 'cargo.exe')) -or -not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        $env:CARGO_HOME = Join-Path $cacheRoot 'cargo'
        $env:RUSTUP_HOME = Join-Path $cacheRoot 'rustup'
        if (-not (Test-Path -LiteralPath (Join-Path $toolchainBin 'cargo.exe'))) {
            if (-not $Install) { throw 'Run Install first to restore Rust.' }
            Invoke-ProjectTool -Tool node -Arguments @((Join-Path $PSScriptRoot 'fetch-rustup.mjs'),$cacheRoot)
            Invoke-ProjectTool -Tool (Join-Path $cacheRoot 'downloads/rustup-init-1.29.1.exe') -Arguments @('-y','--no-modify-path','--profile','minimal','--default-host','x86_64-pc-windows-msvc','--default-toolchain',$toolchain)
        }
        # Use the pinned compiler directly; this also works on filesystems without shim links.
        $env:PATH = $toolchainBin + [IO.Path]::PathSeparator + $env:PATH
    }
    $null = Get-Command cargo -ErrorAction Stop
}
