# Installs the per-minute MuggleMemwatch scheduled task for the current user
# (no elevation needed). Copies the sampler and its launcher to a stable path
# first so the task survives deletion of the source checkout/worktree.
[CmdletBinding()]
param(
    [string]$TaskName = "MuggleMemwatch"
)

$ErrorActionPreference = "Stop"

$installDir = Join-Path $env:USERPROFILE ".muggle-ai\memwatch\bin"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item (Join-Path $PSScriptRoot "memwatch.ps1") (Join-Path $installDir "memwatch.ps1") -Force
$installedLauncher = Join-Path $installDir "memwatch-hidden.vbs"
Copy-Item (Join-Path $PSScriptRoot "memwatch-hidden.vbs") $installedLauncher -Force

# Launching wscript.exe rather than powershell.exe is what keeps the sampler off
# the desktop every minute — see the header of memwatch-hidden.vbs.
$taskAction = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot "System32\wscript.exe") `
    -Argument "`"$installedLauncher`""
# Omitting RepetitionDuration is what makes the repetition indefinite. Passing
# [TimeSpan]::MaxValue instead serializes to P99999999DT23H59M59S, which Windows
# PowerShell 5.1 rejects outright — and 5.1 is what the task itself runs under.
$taskTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1)
$taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
# -Force overwrites in place: unregistering first would leave the machine
# unmonitored for the length of this call, and unmonitored for good if the
# registration below then failed.
Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $taskTrigger `
    -Settings $taskSettings -Force `
    -Description "Per-minute memory sampler + commit tripwire (muggle-ai-works ops/memwatch)" | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5
$taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName
"task $TaskName registered; state=$((Get-ScheduledTask -TaskName $TaskName).State) lastResult=$($taskInfo.LastTaskResult)"
"sampler log dir: $(Join-Path $env:USERPROFILE '.muggle-ai\memwatch')"
