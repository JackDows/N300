$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$run=Join-Path $root ('artifacts/validation/maintenance-'+[Guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Force -Path $run
$policy=Get-Content -LiteralPath (Join-Path $root 'maintenance.json') -Encoding UTF8 -Raw
$script=Join-Path $root 'scripts/maintenance.ps1'
. (Join-Path $root 'scripts/native.ps1')
function Reject-Unsafe([string]$Fixture){
    $info=New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName='powershell.exe'
    $info.Arguments=ConvertTo-ProjectArguments @('-NoProfile','-ExecutionPolicy','Bypass','-File',$script,'-ProjectRoot',$Fixture,'-Action','Clean','-Mode','Build')
    $info.UseShellExecute=$false
    $info.CreateNoWindow=$true
    $info.RedirectStandardError=$true
    $info.RedirectStandardOutput=$true
    $process=[Diagnostics.Process]::Start($info)
    try{
        $stdout=$process.StandardOutput.ReadToEndAsync()
        $stderr=$process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        [IO.File]::WriteAllText((Join-Path $Fixture 'expected-error.log'),($stdout.Result+$stderr.Result))
        Assert ($process.ExitCode -ne 0) 'Unsafe cleanup accepted'
    }finally{$process.Dispose()}
}
function New-Fixture([string]$Name){
    $path=Join-Path $run $Name
    $null=New-Item -ItemType Directory -Force -Path $path
    [IO.File]::WriteAllText((Join-Path $path 'maintenance.json'),$policy)
    return $path
}
function Put([string]$Path,[string]$Text='keep'){
    $null=New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path)
    [IO.File]::WriteAllText($Path,$Text)
}
function Assert([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Clean([string]$Fixture){
    $result=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -ProjectRoot $Fixture -Action Clean -Mode Build
    Assert ($LASTEXITCODE -eq 0) 'Maintenance failed'
    return ($result | ConvertFrom-Json)
}

$a=New-Fixture 'retention'
foreach($path in @('artifacts/build/obj','modules/example/artifacts/build/obj','artifacts/package/Release/app.exe','.local/keys/signing.key','research/evidence/trace.json','src/main.rs','artifacts/data/online/devices.json')){Put (Join-Path $a $path)}
# No runtime package deletion is attempted without a valid configuration.
Put (Join-Path $a 'artifacts/data/online/devices.json') '{"schemaVersion":1,"devices":[]}'
foreach($n in 1..4){$path=Join-Path $a "artifacts/validation/integration-Debug-$n/result.json";Put $path;(Get-Item (Split-Path $path -Parent)).LastWriteTimeUtc=[DateTime]::UtcNow.AddMinutes(-$n)}
$result=Clean $a
Assert (-not(Test-Path (Join-Path $a 'artifacts/build'))) 'Build cache retained'
Assert (-not(Test-Path (Join-Path $a 'modules/example/artifacts/build'))) 'Module cache retained'
Assert ((@(Get-ChildItem (Join-Path $a 'artifacts/validation') -Directory)).Count -eq 2) 'Test retention count wrong'
foreach($path in @('artifacts/package/Release/app.exe','.local/keys/signing.key','research/evidence/trace.json','src/main.rs','artifacts/data/online/devices.json')){Assert (Test-Path (Join-Path $a $path)) "Protected file removed: $path"}
Write-Output 'PASS build cleanup, test retention, source/key/package/config protection'

$b=New-Fixture 'locks'
Put (Join-Path $b '.local/operation.lock') ''
Put (Join-Path $b 'artifacts/build/obj')
$lock=[IO.File]::Open((Join-Path $b '.local/operation.lock'),'Open','ReadWrite','None')
try{$result=Clean $b;Assert ($result.skipped -eq 'project operation in progress') 'Active build not skipped';Assert (Test-Path (Join-Path $b 'artifacts/build/obj')) 'Active build removed'}finally{$lock.Dispose()}
Write-Output 'PASS active build lock'

$c=New-Fixture 'runtime'
$data=Join-Path $c 'artifacts/data/online'
$packages=@()
foreach($n in 1..4){$path=Join-Path $data "modules/example/0.$n/hash";Put (Join-Path $path 'module.json') '{}';(Get-Item $path).LastWriteTimeUtc=[DateTime]::UtcNow.AddDays(-10-$n);$packages+=$path}
Put (Join-Path $data 'devices.json') (@{schemaVersion=1;devices=@(@{packagePath=$packages[3]})} | ConvertTo-Json -Depth 5)
Put (Join-Path $data 'backend.lock') ''
$lock=[IO.File]::Open((Join-Path $data 'backend.lock'),'Open','ReadWrite','None')
try{$result=Clean $c;Assert (Test-Path $packages[2]) 'Running backend package removed'}finally{$lock.Dispose()}
$result=Clean $c
Assert (-not(Test-Path $packages[2])) 'Old unused module retained'
foreach($i in @(0,1,3)){Assert (Test-Path $packages[$i]) 'Current/bound module removed'}
Write-Output 'PASS runtime lock, bound version protection and old package retention'

$d=New-Fixture 'paths'
Put (Join-Path $d 'research/evidence/original')
$bad=$policy | ConvertFrom-Json
$bad.buildCaches=@('research')
Put (Join-Path $d 'maintenance.json') ($bad | ConvertTo-Json -Depth 6)
Reject-Unsafe $d
Assert (Test-Path (Join-Path $d 'research/evidence/original')) 'Evidence was removed'
Put (Join-Path $d 'maintenance.json') $policy
$null=New-Item -ItemType Directory -Force -Path (Join-Path $d 'artifacts')
$link=Join-Path $d 'artifacts/build'
$null=New-Item -ItemType Junction -Path $link -Target (Join-Path $d 'research')
try{
    Reject-Unsafe $d
    Assert (Test-Path (Join-Path $d 'research/evidence/original')) 'Junction target was removed'
}finally{[IO.Directory]::Delete($link)}
Write-Output 'PASS path allowlist and junction rejection'
