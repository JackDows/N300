# Opt-in real-device check; excluded from CTest. The round trip restores brightness.
param(
    [string]$Executable = (Join-Path $PSScriptRoot '../artifacts/dist/Debug/og98.exe'),
    [ValidateRange(0,300)][int]$WaitForKeyboardSeconds = 0,
    [switch]$BrightnessRoundTrip
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $projectRoot 'scripts/native.ps1')
$null = New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'artifacts/analysis')
$records = New-Object System.Collections.Generic.List[object]
$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = (Resolve-Path -LiteralPath $Executable).Path
$info.Arguments = ConvertTo-ProjectArguments @('--log',(Join-Path $projectRoot 'artifacts/logs/hardware-validation.jsonl'),'serve')
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.RedirectStandardInput = $true
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$info.StandardOutputEncoding = [Text.Encoding]::UTF8
$process = New-Object System.Diagnostics.Process
$process.StartInfo = $info
$counter = 0
function Send-Request([string]$Method, [hashtable]$Parameters = @{}) {
    $script:counter += 1
    $request = @{ id=$script:counter; method=$Method; params=$Parameters } | ConvertTo-Json -Compress -Depth 10
    $process.StandardInput.WriteLine($request)
    $process.StandardInput.Flush()
    $line = $process.StandardOutput.ReadLine()
    if ($null -eq $line) { throw 'CLI closed before its response' }
    $response = $line | ConvertFrom-Json
    $records.Add($response)
    return $response
}
function Require-Success($Response) {
    if (-not $Response.ok) { throw ($Response.error | ConvertTo-Json -Compress -Depth 10) }
    return $Response.result
}
$before = $null
$restored = $false
$started = $false
try {
    $null = $process.Start()
    $started = $true
    $stderr = $process.StandardError.ReadToEndAsync()
    $deadline = [DateTime]::UtcNow.AddSeconds($WaitForKeyboardSeconds)
    do {
        $connection = Send-Request 'connect' @{ model='OG98' }
        if ($connection.ok) { break }
        if ($connection.error.code -ne 'device_not_responding' -or [DateTime]::UtcNow -ge $deadline) { $null = Require-Success $connection }
        Start-Sleep -Milliseconds 1000
    } while ($true)
    $baseline = Require-Success (Send-Request 'status')
    $before = $baseline.lighting.brightness
    if ($BrightnessRoundTrip) {
        $target = if ($before -eq 0) { 1 } else { $before - 1 }
        try {
            $changed = Require-Success (Send-Request 'set' @{ name='brightness'; value=$target })
            if (-not $changed.verified) { throw 'Brightness was not confirmed' }
        } finally {
            $restore = Require-Success (Send-Request 'set' @{ name='brightness'; value=$before })
            $restored = [bool]$restore.verified
        }
    }
    $after = Require-Success (Send-Request 'status')
    if (($baseline | ConvertTo-Json -Depth 20 -Compress) -ne ($after | ConvertTo-Json -Depth 20 -Compress)) { throw 'Final settings differ from initial settings' }
    $result = @{ verified=$true; brightnessRoundTrip=[bool]$BrightnessRoundTrip; restored=$restored; baseline=$baseline; after=$after; capturedAt=[DateTime]::UtcNow.ToString('o') }
    $output = Join-Path $projectRoot 'artifacts/analysis/hardware-validation.json'
    [IO.File]::WriteAllText($output,($result | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
    $result | ConvertTo-Json -Depth 20
} finally {
    if ($started -and -not $process.HasExited) {
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(5000)) { $process.Kill() }
    }
    $process.Dispose()
    $recordPath = Join-Path $projectRoot 'artifacts/analysis/hardware-requests.json'
    [IO.File]::WriteAllText($recordPath,($records | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
}
