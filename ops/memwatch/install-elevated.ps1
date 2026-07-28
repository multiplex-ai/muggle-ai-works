# Elevated half of the memwatch install: the perfmon flight recorder (logman
# circular counter log + boot autostart) and process-creation auditing (4688
# with command lines). Requires admin; writes a machine-readable result file so
# an unelevated caller can verify the outcome.
[CmdletBinding()]
param(
    [string]$CollectorName = "muggle-memflight",
    [string]$LogDir = (Join-Path $env:USERPROFILE ".muggle-ai\memwatch"),
    [int]$SampleIntervalSeconds = 30,
    [int]$MaxLogMb = 512
)

$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$resultFile = Join-Path $LogDir "install-elevated-result.json"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Set-Content $resultFile ([ordered]@{ ok = $false; error = "not elevated" } | ConvertTo-Json)
    exit 2
}

$steps = [ordered]@{}

# --- A: flight recorder -------------------------------------------------------
$flightDir = Join-Path $LogDir "flight"
New-Item -ItemType Directory -Force -Path $flightDir | Out-Null
& logman stop $CollectorName 2>$null | Out-Null
& logman delete $CollectorName 2>$null | Out-Null
$counters = @(
    '\Memory\Committed Bytes',
    '\Memory\% Committed Bytes In Use',
    '\Memory\Available MBytes',
    '\Process(*)\Private Bytes',
    '\Process(*)\Working Set'
)
& logman create counter $CollectorName -f bincirc -max $MaxLogMb `
    -si ([TimeSpan]::FromSeconds($SampleIntervalSeconds).ToString()) `
    -c $counters -o (Join-Path $flightDir "memflight") -ow -y | Out-Null
$createExit = $LASTEXITCODE
& logman start $CollectorName | Out-Null
$startExit = $LASTEXITCODE
$queryOutput = (& logman query $CollectorName 2>&1) -join "`n"
$flightRunning = ($startExit -eq 0) -and ($queryOutput -match "Running")
$steps.flightRecorder = [ordered]@{
    ok        = $flightRunning
    createExit = $createExit
    startExit  = $startExit
    logDir     = $flightDir
}

# Auto-restart after reboot: a DCS does not survive one on its own.
& schtasks /Create /F /TN "MuggleMemflightBoot" /SC ONSTART /RU SYSTEM `
    /TR "logman start $CollectorName" | Out-Null
$steps.flightBootTask = [ordered]@{ ok = ($LASTEXITCODE -eq 0) }

# --- C: process-creation audit (4688 + command lines) -------------------------
# GUID form survives non-English locales; it is the Process Creation subcategory.
& auditpol /set /subcategory:"{0CCE922B-69AE-11D9-BED3-505054503030}" /success:enable | Out-Null
$auditExit = $LASTEXITCODE
& reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit" `
    /v ProcessCreationIncludeCmdLine_Enabled /t REG_DWORD /d 1 /f | Out-Null
$regExit = $LASTEXITCODE
$auditState = (& auditpol /get /subcategory:"{0CCE922B-69AE-11D9-BED3-505054503030}" 2>&1) -join "`n"
$steps.processAudit = [ordered]@{
    ok        = ($auditExit -eq 0 -and $regExit -eq 0)
    auditExit = $auditExit
    regExit   = $regExit
    state     = ($auditState -split "`n" | Select-Object -Last 2) -join " "
}

$allOk = $true
foreach ($step in $steps.Values) { if (-not $step.ok) { $allOk = $false } }
Set-Content $resultFile ([ordered]@{
        ok          = $allOk
        completedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        steps       = $steps
    } | ConvertTo-Json -Depth 4)
if (-not $allOk) { exit 1 }
