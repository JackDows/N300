function Get-DeskHubCacheRoot {
    $sourceRoot=Split-Path -Parent $PSScriptRoot
    $selected=$env:DESKHUB_CACHE_ROOT
    $localSetting=Join-Path $sourceRoot '.local/cache-root.txt'
    if(-not $selected -and (Test-Path -LiteralPath $localSetting)){$selected=(Get-Content -LiteralPath $localSetting -Raw).Trim()}
    if(-not $selected){$selected='.local/dependencies/tools'}
    if(-not [IO.Path]::IsPathRooted($selected)){$selected=Join-Path $sourceRoot $selected}
    return [IO.Path]::GetFullPath($selected)
}
