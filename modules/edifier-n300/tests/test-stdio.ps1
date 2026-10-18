param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference = 'Stop'
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $Executable
$start.Arguments = '--offline --no-autoconnect serve'
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.StandardOutputEncoding = [Text.Encoding]::UTF8
$start.StandardErrorEncoding = [Text.Encoding]::UTF8
$process = New-Object System.Diagnostics.Process
$process.StartInfo = $start
try {
    $null = $process.Start()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $lines = @(
        '{"jsonrpc":"2.0","id":1,"method":"set","params":{"property":"volume","value":9}}',
        '{"jsonrpc":"2.0","id":2,"method":"get","params":{"property":"volume"}}',
        'malformed',
        '[{"jsonrpc":"2.0","id":3,"method":"describe"},{"jsonrpc":"2.0","method":"diagnostics"}]',
        '{"jsonrpc":"2.0","id":4,"method":"unknown"}',
        '{"jsonrpc":"2.0","id":5,"method":"set","params":{"property":"led","value":"false"}}',
        '{"jsonrpc":"2.0","id":6,"method":"diagnostics"}',
        '{"jsonrpc":"2.0","id":7,"method":"stop"}'
    )
    foreach ($line in $lines) { $process.StandardInput.WriteLine($line) }
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(15000)) { $process.Kill(); throw 'stdio EOF shutdown timed out' }
    if ($process.ExitCode -ne 0) { throw $stderr.Result }
    $messages = @($stdout.Result -split '\r?\n' | Where-Object { $_ } | ForEach-Object { $decoded = ConvertFrom-Json $_; foreach ($item in $decoded) { $item } })
    $responses = @{}
    foreach ($message in $messages) {
        if ($message.PSObject.Properties.Name -contains 'id' -and $null -ne $message.id) { $responses[[string]$message.id] = $message }
    }
    if ($responses['1'].result.value -ne 9 -or $responses['2'].result.value -ne 9) { throw 'stdio write/read mismatch' }
    if ($responses['3'].result.device -ne 'edifier.n300') { throw 'batch response missing' }
    if ($responses['4'].error.code -ne -32601 -or $responses['5'].error.code -ne -32602) { throw 'RPC error mapping failed' }
    if ($responses['6'].result.connection_count -ne 1 -or $responses['6'].result.scan_count -ne 1) { throw 'stdio did not reuse its connection' }
    if ($responses['7'].result.connected) { throw 'stop left the device connected' }
    if (-not ($messages | Where-Object { $_.error.code -eq -32700 })) { throw 'parse error recovery missing' }
    Write-Host 'stdio: read/write, batches, notifications, errors and EOF passed'
} finally { $process.Dispose() }
