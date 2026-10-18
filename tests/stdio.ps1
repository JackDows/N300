param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference = 'Stop'
$requests = @(
    '{"id":1,"method":"connect"}',
    '{"id":2,"method":"set","params":{"name":"brightness","value":2}}',
    '{"id":3,"method":"get","params":{"name":"lighting"}}',
    '{broken',
    '{"id":5,"method":"disconnect"}'
)
$output = @($requests | & $Executable --offline --no-log serve)
if ($LASTEXITCODE -ne 0 -or $output.Count -ne 5) { throw 'Expected one response per input line' }
$rows = @($output | ForEach-Object { $_ | ConvertFrom-Json })
if (-not $rows[0].ok -or $rows[0].id -ne 1) { throw 'Connect response failed' }
if (-not $rows[1].result.verified -or $rows[2].result.brightness -ne 2) { throw 'Persistent stdio state failed' }
if ($rows[3].error.code -ne 'invalid_request' -or -not $rows[4].ok) { throw 'Malformed request broke session' }
Write-Host 'PASS stdio framing, persistent state and error recovery'
