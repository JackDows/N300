# Shared native-process handling for Windows PowerShell 5.1 and PowerShell 7.
# Python tooling writes ordinary progress to stderr; only its exit code is failure.
function Invoke-ProjectPython {
    param(
        [Parameter(Mandatory=$true)][string[]]$Arguments,
        [string]$LogPath,
        [switch]$Quiet
    )
    $root = Split-Path -Parent $PSScriptRoot
    $python = Join-Path $root '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $python)) { throw 'Run the install task first' }
    $quotedArguments = foreach ($value in $Arguments) {
        # Windows CRT argument escaping, without invoking a command shell.
        $escaped = [regex]::Replace($value, '(\\*)"', '$1$1\"')
        $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
        '"' + $escaped + '"'
    }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $python
    $startInfo.Arguments = $quotedArguments -join ' '
    $startInfo.WorkingDirectory = $root
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [Text.Encoding]::UTF8
    $env:PYTHONUTF8 = '1'
    $env:PIP_DISABLE_PIP_VERSION_CHECK = '1'
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
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
        if (-not $Quiet -or $process.ExitCode -ne 0) {
            if ($output) { Write-Host $output.TrimEnd() }
        }
        if ($process.ExitCode -ne 0) { throw "Python command failed (exit $($process.ExitCode)): $($Arguments -join ' ')" }
    } finally { $process.Dispose() }
}
