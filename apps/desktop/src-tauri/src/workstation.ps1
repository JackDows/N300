param([ValidateSet('Inspect','OpenMangoDisk')][string]$Action = 'Inspect')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Find-MangoDisk {
    $shell = New-Object -ComObject WScript.Shell
    foreach ($root in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'))) {
        foreach ($relative in @('MangoDisk.lnk', 'MangoDisk\MangoDisk.lnk')) {
            $shortcut = Join-Path $root $relative
            if (Test-Path -LiteralPath $shortcut -PathType Leaf) {
                $target = $shell.CreateShortcut($shortcut).TargetPath
                if ([IO.Path]::GetFileName($target) -ieq 'MangoDisk.exe' -and (Test-Path -LiteralPath $target -PathType Leaf)) { return $target }
            }
        }
    }
    return $null
}

$mango = Find-MangoDisk
if ($Action -eq 'OpenMangoDisk') {
    if (-not $mango) { throw 'MangoDisk shortcut target was not found' }
    # This is the interactive application the user explicitly selected. The helper stays hidden.
    Start-Process -FilePath $mango -WorkingDirectory ([IO.Path]::GetDirectoryName($mango))
    '{"opened":true,"simulated":false}'
    exit
}

# Inventory is read on demand. No serials, MACs, account names or live telemetry are collected.
$warnings = @()
function Read-Cim([string]$class) {
    try { @(Get-CimInstance -ClassName $class) } catch { $script:warnings += "$class`: $($_.Exception.Message)"; @() }
}
$parts = [ordered]@{
    cpu = @(Read-Cim 'Win32_Processor' | ForEach-Object { @{name=$_.Name.Trim();detail="$($_.NumberOfCores) 核心 · $($_.NumberOfLogicalProcessors) 线程"} })
    gpu = @(Read-Cim 'Win32_VideoController' | Where-Object { $_.PNPDeviceID -like 'PCI*' } | ForEach-Object { @{name=$_.Name.Trim();detail="驱动 $($_.DriverVersion)"} })
    memory = @(Read-Cim 'Win32_PhysicalMemory' | ForEach-Object { @{name="$([math]::Round($_.Capacity / 1GB)) GB · $($_.DeviceLocator.Trim())";detail="$($_.ConfiguredClockSpeed) MT/s · $($_.PartNumber.Trim())"} })
    motherboard = @(Read-Cim 'Win32_BaseBoard' | ForEach-Object { @{name=$_.Product.Trim();detail=$_.Manufacturer.Trim()} })
    storage = @(Read-Cim 'Win32_DiskDrive' | ForEach-Object { @{name=$_.Model.Trim();detail=if($_.Size -ge 1000000000000){'{0:N2} TB' -f ($_.Size / 1000000000000)}else{'{0:N0} GB' -f ($_.Size / 1000000000)}} })
    network = @()
}
try { $parts.network = @(Get-NetAdapter -Physical | Sort-Object InterfaceDescription -Unique | ForEach-Object { @{name=$_.InterfaceDescription} }) }
catch { $warnings += "NetAdapter: $($_.Exception.Message)" }
@{source='windows';parts=$parts;mangodisk=[bool]$mango;warnings=$warnings} | ConvertTo-Json -Depth 6 -Compress
