# Installs the per-minute MuggleMemwatch scheduled task for the current user
# (no elevation needed). Copies memwatch.ps1 to a stable path first so the task
# survives deletion of the source checkout/worktree.
[CmdletBinding()]
param(
    [string]$TaskName = "MuggleMemwatch"
)

$ErrorActionPreference = "Stop"

$installDir = Join-Path $env:USERPROFILE ".muggle-ai\memwatch\bin"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$installedScript = Join-Path $installDir "memwatch.ps1"
Copy-Item (Join-Path $PSScriptRoot "memwatch.ps1") $installedScript -Force

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }

$taskAction = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$installedScript`""
$taskTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration ([TimeSpan]::MaxValue)
$taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $taskTrigger `
    -Settings $taskSettings -Description "Per-minute memory sampler + commit tripwire (muggle-ai-works ops/memwatch)" | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5
$taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName
"task $TaskName registered; state=$((Get-ScheduledTask -TaskName $TaskName).State) lastResult=$($taskInfo.LastTaskResult)"
"sampler log dir: $(Join-Path $env:USERPROFILE '.muggle-ai\memwatch')"
