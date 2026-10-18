param(
    [ValidateSet('Inspect','Clean','RegisterSchedule')][string]$Action='Inspect',
    [ValidateSet('Expired','Build')][string]$Mode='Expired',
    [string]$ProjectRoot=(Split-Path -Parent $PSScriptRoot),
    [switch]$IncludeUserData,
    [switch]$Quiet
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $ProjectRoot).ProviderPath.TrimEnd('\','/')
$policy=Get-Content -LiteralPath (Join-Path $root 'maintenance.json') -Encoding UTF8 -Raw | ConvertFrom-Json
if($policy.schemaVersion -ne 1){throw 'Unsupported maintenance policy'}
$now=[DateTime]::UtcNow
$removed=New-Object 'System.Collections.Generic.List[object]'
$skipped=New-Object 'System.Collections.Generic.List[object]'
$planned=New-Object 'System.Collections.Generic.List[object]'
$runningPaths=@(Get-Process | ForEach-Object {try{$_.Path}catch{}} | Where-Object {$_})

function Test-Inside([string]$Path,[string]$Parent){
    return $Path.StartsWith($Parent.TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)
}
function Get-SafeTree([string]$Path){
    # Validate each ancestor and every child before traversing/removing a tree.
    $cursor=Get-Item -LiteralPath $Path -Force
    while($cursor){
        if($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Refusing reparse point: $($cursor.FullName)"}
        $cursor=if($cursor.PSIsContainer){$cursor.Parent}else{$cursor.Directory}
    }
    $queue=New-Object 'System.Collections.Generic.Queue[string]'
    $queue.Enqueue($Path)
    while($queue.Count){
        $item=Get-Item -LiteralPath $queue.Dequeue() -Force
        if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Refusing reparse point: $($item.FullName)"}
        $item
        if($item.PSIsContainer){foreach($child in Get-ChildItem -LiteralPath $item.FullName -Force){$queue.Enqueue($child.FullName)}}
    }
}
function Get-Matches([string]$Pattern){
    if([IO.Path]::IsPathRooted($Pattern) -or $Pattern -match '(^|[/\\])\.\.([/\\]|$)'){throw "Unsafe policy path: $Pattern"}
    @(Get-Item -Path (Join-Path $root $Pattern) -Force -ErrorAction SilentlyContinue)
}
function Remove-Candidate([string]$Path,[string]$Reason,[string]$DataRoot=''){
    if(-not(Test-Path -LiteralPath $Path)){return}
    $absolute=(Resolve-Path -LiteralPath $Path).ProviderPath
    if($DataRoot){
        $valid=(Test-Inside $absolute (Join-Path $DataRoot 'modules')) -or (Test-Inside $absolute (Join-Path $DataRoot 'logs'))
    }else{
        if(-not(Test-Inside $absolute $root)){throw "Cleanup path escaped project: $absolute"}
        $relative=$absolute.Substring($root.Length+1).Replace('\','/')
        $valid=$relative -match '^(artifacts/(build|validation|screenshots|data/fixtures-[^/]+)(/|$)|modules/[^/]+/artifacts/(build|dist|package|validation|desktop|installers|updates)(/|$)|\.local/(repro-[^/]+|tmp)(/|$)|apps/desktop/(dist|test-results|playwright-report)(/|$))'
        foreach($pattern in $policy.protected){
            foreach($protected in (Get-Matches $pattern)){
                if($absolute -eq $protected.FullName -or (Test-Inside $absolute $protected.FullName) -or (Test-Inside $protected.FullName $absolute)){$valid=$false}
            }
        }
    }
    if(-not $valid){throw "Cleanup path is protected: $absolute"}
    try{
        foreach($executable in $runningPaths){if($executable -eq $absolute -or (Test-Inside $executable $absolute)){throw "Program is running: $executable"}}
        $tree=@(Get-SafeTree $absolute)
        $bytes=[long](($tree | Where-Object {-not $_.PSIsContainer} | Measure-Object -Property Length -Sum).Sum)
        $entry=[pscustomobject]@{path=$absolute;bytes=$bytes;reason=$Reason}
        $planned.Add($entry)
        if($Action -eq 'Clean'){
            Remove-Item -LiteralPath $absolute -Force -Recurse
            $removed.Add($entry)
        }
    }catch{
        $skipped.Add([pscustomobject]@{path=$absolute;reason=$_.Exception.Message})
    }
}
function Invoke-RuntimeCleanup([string]$Directory){
    if(-not(Test-Path -LiteralPath $Directory)){return}
    $dataRoot=(Resolve-Path -LiteralPath $Directory).ProviderPath
    $dataLock=$null
    try{
        $null=Get-SafeTree $dataRoot
        # The backend holds this same lock for its entire lifetime.
        $dataLock=[IO.File]::Open((Join-Path $dataRoot 'backend.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        $bindingsFile=Join-Path $dataRoot 'devices.json'
        $bound=@()
        if(Test-Path -LiteralPath $bindingsFile){
            $saved=Get-Content -LiteralPath $bindingsFile -Encoding UTF8 -Raw | ConvertFrom-Json
            if($saved.schemaVersion -ne 1){throw 'Unknown device configuration; keeping runtime packages'}
            $bound=@($saved.devices | ForEach-Object {[IO.Path]::GetFullPath($_.packagePath)})
        }
        foreach($module in @(Get-ChildItem -LiteralPath (Join-Path $dataRoot 'modules') -Directory -ErrorAction SilentlyContinue)){
            $packages=@(Get-ChildItem -Path (Join-Path $module.FullName '*/*') -Directory | Sort-Object LastWriteTimeUtc -Descending)
            for($i=0;$i -lt $packages.Count;$i++){
                $package=$packages[$i]
                if($i -ge $policy.runtimePackageKeep -and $package.LastWriteTimeUtc -lt $now.AddDays(-$policy.runtimePackageMinAgeDays) -and $package.FullName -notin $bound){
                    Remove-Candidate $package.FullName 'unreferenced-runtime-package' $dataRoot
                }
            }
        }
        $logs=@(Get-ChildItem -LiteralPath (Join-Path $dataRoot 'logs') -File -ErrorAction SilentlyContinue | Where-Object {$_.Name -match '^.+-\d+\.jsonl(\.\d+)?$'} | Sort-Object LastWriteTimeUtc -Descending)
        for($i=$policy.runtimeLogKeep;$i -lt $logs.Count;$i++){
            if($logs[$i].LastWriteTimeUtc -lt $now.AddDays(-$policy.runtimeLogDays)){Remove-Candidate $logs[$i].FullName 'expired-device-log' $dataRoot}
        }
    }catch{$skipped.Add([pscustomobject]@{path=$dataRoot;reason=$_.Exception.Message})}
    finally{if($dataLock){$dataLock.Dispose()}}
}

if($Action -eq 'RegisterSchedule'){
    $hash=[Security.Cryptography.SHA256]::Create()
    try{$suffix=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())))).Replace('-','').Substring(0,10)}finally{$hash.Dispose()}
    $taskName="DeskHub-Maintenance-$suffix"
    $arguments='-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $root 'scripts/maintenance.ps1')+'" -Action Clean -Mode Expired -IncludeUserData -Quiet'
    $taskAction=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $root
    $trigger=New-ScheduledTaskTrigger -Daily -At '03:30'
    $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    $null=Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal -Description 'Clean expired DeskHub generated files; preserve source, keys, evidence, installed packages and device settings.' -Force
    [pscustomobject]@{taskName=$taskName;dailyLocalTime='03:30';projectRoot=$root} | ConvertTo-Json
    return
}

$null=New-Item -ItemType Directory -Force -Path (Join-Path $root '.local')
$operationLock=$null
try{
    try{$operationLock=[IO.File]::Open((Join-Path $root '.local/operation.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}
    catch{if(-not $Quiet){Write-Output '{"skipped":"project operation in progress"}'};return}
    $builds=@(foreach($pattern in $policy.buildCaches){Get-Matches $pattern})
    $cacheBytes=0L
    foreach($build in $builds){$cacheBytes+=[long]((Get-SafeTree $build.FullName | Where-Object {-not $_.PSIsContainer} | Measure-Object Length -Sum).Sum)}
    $stamp=Join-Path $root '.local/last-build.txt'
    $lastBuild=if(Test-Path -LiteralPath $stamp){[DateTime]::Parse((Get-Content -LiteralPath $stamp -Raw)).ToUniversalTime()}else{$now}
    if($Mode -eq 'Build' -or $cacheBytes -gt $policy.buildCacheMaxMiB*1MB -or $lastBuild -lt $now.AddDays(-$policy.buildCacheMaxIdleDays)){
        foreach($build in $builds){Remove-Candidate $build.FullName 'build-cache'}
    }
    foreach($rule in $policy.retention){
        $items=@(Get-Matches $rule.pattern | Sort-Object LastWriteTimeUtc -Descending)
        for($i=0;$i -lt $items.Count;$i++){
            # keep=0 means age-only retention; otherwise both age and count are bounded.
            if($items[$i].LastWriteTimeUtc -lt $now.AddDays(-$rule.days) -or ($rule.keep -gt 0 -and $i -ge $rule.keep)){
                Remove-Candidate $items[$i].FullName 'retention'
            }
        }
    }
    foreach($modeName in @('online','offline')){Invoke-RuntimeCleanup (Join-Path $root "artifacts/data/$modeName")}
    if($IncludeUserData){foreach($modeName in @('online','offline')){Invoke-RuntimeCleanup (Join-Path $env:LOCALAPPDATA "DeskHub/backend/$modeName")}}
    $report=[ordered]@{timeUtc=$now.ToString('o');action=$Action;mode=$Mode;buildCacheBytes=$cacheBytes;planned=@($planned.ToArray());removed=@($removed.ToArray());skipped=@($skipped.ToArray())}
    $json=$report | ConvertTo-Json -Depth 8
    if($Action -eq 'Clean'){
        [IO.File]::WriteAllText((Join-Path $root '.local/maintenance-last.json'),$json,[Text.UTF8Encoding]::new($false))
    }
    if(-not $Quiet){$json}
}finally{if($operationLock){$operationLock.Dispose()}}
