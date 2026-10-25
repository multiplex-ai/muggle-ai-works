# Installs the MuggleWatch scheduled task for the current user (no elevation):
# every -IntervalMinutes it runs `muggle watch tick`, which snapshots Claude and
# Codex sessions, their processes and every PR-watch slot, alerts on dead or deaf
# watchers, red CI and stale branches, resumes the owner session of a registered
# slot whose watcher died, and fans plugin reloads out across sessions.
#
# The task runs the global @muggleai/works install, whose path survives
# `muggle upgrade`, so the service always runs the current release. Only the
# launcher shim is copied, to ~\.muggle-ai\watch\bin, so the task never points
# into a checkout or worktree that may be deleted.
[CmdletBinding()]
param(
    [ValidateRange(1, 60)]
    [int]$IntervalMinutes = 2,
    [string]$TaskName = "MuggleWatch",
    [string]$MuggleEntry,
    [switch]$NoAutoReload,
    [switch]$NoRecovery,
    # Return once the task is registered; its trigger runs the first tick a minute later.
    [switch]$NoWait,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        "task $TaskName removed; ledger kept at $(Join-Path $env:USERPROFILE '.muggle-ai\watch')"
    } else {
        "task $TaskName is not installed"
    }
    return
}

if (-not $MuggleEntry) {
    $npmRoot = (& npm root -g 2>$null | Select-Object -First 1)
    if ($npmRoot) { $MuggleEntry = Join-Path $npmRoot "@muggleai\works\bin\muggle.js" }
}
if (-not $MuggleEntry -or -not (Test-Path $MuggleEntry)) {
    throw "No global @muggleai/works install found. Run 'npm install -g @muggleai/works', or pass -MuggleEntry <path to bin\muggle.js>."
}
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw "node is not on PATH; the task needs it to run muggle." }
foreach ($requiredTool in @("claude", "gh")) {
    if (-not (Get-Command $requiredTool -ErrorAction SilentlyContinue)) {
        Write-Warning "$requiredTool is not on PATH — the watch will report without the data it provides."
    }
}

$watchDir = Join-Path $env:USERPROFILE ".muggle-ai\watch"
$installDir = Join-Path $watchDir "bin"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$installedLauncher = Join-Path $installDir "muggle-watch-hidden.vbs"
Copy-Item (Join-Path $PSScriptRoot "muggle-watch-hidden.vbs") $installedLauncher -Force

$tickFlags = @()
if ($NoAutoReload) { $tickFlags += "--no-auto-reload" }
if ($NoRecovery) { $tickFlags += "--no-recovery" }
$launcherArguments = @("`"$installedLauncher`"", "`"$($nodeCommand.Source)`"", "`"$MuggleEntry`"") + $tickFlags

# wscript.exe rather than node.exe is what keeps every run off the desktop — see
# the header of muggle-watch-hidden.vbs.
$taskAction = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot "System32\wscript.exe") `
    -Argument ($launcherArguments -join " ")
# Omitting RepetitionDuration is what makes the repetition indefinite; passing
# [TimeSpan]::MaxValue serializes to a duration Windows PowerShell 5.1 rejects.
$taskTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
# The battery switches matter on laptops: the defaults skip every run on battery.
$taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
# -Force replaces the task in place: unregistering first would leave a window with
# no watch at all, and no watch for good if the registration then failed.
Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $taskTrigger `
    -Settings $taskSettings -Force `
    -Description "Muggle watch service: tracks agent sessions, processes and PR watchers (@muggleai/works)" | Out-Null

if ($NoWait) {
    "task $TaskName registered every $IntervalMinutes min; first tick within a minute"
    return
}

$statusFile = Join-Path $watchDir "status.json"
$previousSnapshotTime = if (Test-Path $statusFile) { (Get-Item $statusFile).LastWriteTime } else { [DateTime]::MinValue }
Start-ScheduledTask -TaskName $TaskName
$deadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $deadline) {
    if ((Test-Path $statusFile) -and (Get-Item $statusFile).LastWriteTime -gt $previousSnapshotTime) { break }
    Start-Sleep -Seconds 2
}
$taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName
"task $TaskName registered every $IntervalMinutes min; state=$((Get-ScheduledTask -TaskName $TaskName).State) lastResult=$($taskInfo.LastTaskResult)"
if ((Test-Path $statusFile) -and (Get-Item $statusFile).LastWriteTime -gt $previousSnapshotTime) {
    "first tick written: $statusFile — run 'muggle watch status' to read it"
} else {
    Write-Warning "no tick finished within 120s; check $(Join-Path $watchDir 'tick.log')"
}
