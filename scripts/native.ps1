# Native process execution for PowerShell 5.1 and 7; no Python/Node runtime needed.
function ConvertTo-ProjectArguments {
    param([string[]]$Values)
    ($Values | ForEach-Object {
        $escaped = [regex]::Replace($_, '(\\*)"', '$1$1\"')
        $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
        '"' + $escaped + '"'
    }) -join ' '
}
function Invoke-ProjectTool {
    param([Parameter(Mandatory=$true)][string]$Tool, [string[]]$Arguments, [string]$LogPath)
    $command = Get-Command $Tool -ErrorAction Stop
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $command.Source
    $info.Arguments = ConvertTo-ProjectArguments $Arguments
    $info.WorkingDirectory = Split-Path -Parent $PSScriptRoot
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [Text.Encoding]::UTF8
    $info.StandardErrorEncoding = [Text.Encoding]::UTF8
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        $null = $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $output = $stdout.Result + $stderr.Result
        if ($LogPath) {
            $null = New-Item -ItemType Directory -Path (Split-Path -Parent $LogPath) -Force
            [IO.File]::WriteAllText($LogPath, $output, (New-Object Text.UTF8Encoding($false)))
        }
        if ($output) { Write-Host $output.TrimEnd() }
        if ($process.ExitCode -ne 0) { throw "$Tool failed with exit code $($process.ExitCode)" }
    } finally { $process.Dispose() }
}
