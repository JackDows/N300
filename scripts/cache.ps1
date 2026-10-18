function Get-DeskHubCacheRoot {
    $selected=$env:DESKHUB_CACHE_ROOT
    # Avoid MSIX AppData redirection and its long paths when launched from packaged IDEs.
    if(-not $selected){$selected=Join-Path $env:USERPROFILE '.cache/DeskHub'}
    return [IO.Path]::GetFullPath($selected)
}
