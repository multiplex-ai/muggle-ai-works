# Per-minute memory sampler + commit tripwire. Runs from the MuggleMemwatch
# scheduled task via memwatch-hidden.vbs (see install-memwatch.ps1);
# PowerShell 5.1-compatible.
[CmdletBinding()]
param(
    [string]$LogDir = (Join-Path $env:USERPROFILE ".muggle-ai\memwatch"),
    [int]$TopN = 15,
    [string[]]$AlwaysTrackedProcessNames = @("claude.exe"),
    [int]$MaxProcessEntriesPerSample = 60,
    [double]$TripCommitPct = 85,
    [double]$RearmCommitPct = 75,
    [int]$SampleRetentionDays = 14,
    [int]$SnapshotRetentionDays = 90,
    [int]$LogDirBudgetMb = 100,
    [switch]$ForceTrip
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$now = Get-Date

# TotalVirtualMemorySize/FreeVirtualMemory are the commit limit and commit
# available, so one CIM call replaces a '\Memory\*' Get-Counter pair that cost
# ~1s of the sampler's ~1.7s runtime and agreed to within 0.02.
$osInfo = Get-CimInstance Win32_OperatingSystem
$commitLimitKb = [double]$osInfo.TotalVirtualMemorySize
$commitUsedKb = $commitLimitKb - [double]$osInfo.FreeVirtualMemory
$commitPct = [math]::Round(($commitUsedKb / $commitLimitKb) * 100, 1)
$commitGb = [math]::Round($commitUsedKb / 1MB, 2)
$freeRamGb = [math]::Round($osInfo.FreePhysicalMemory / 1MB, 2)

$allProcesses = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name,
PrivatePageCount, WorkingSetSize, CommandLine, CreationDate
$livePids = @{}
foreach ($processRow in $allProcesses) { $livePids[[int]$processRow.ProcessId] = $true }

$sessionIdPattern = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"

function Resolve-ClaudeSessionId {
    param([string]$CommandLine)
    if (-not $CommandLine) { return "" }
    $sessionIdMatch = [regex]::Match($CommandLine, "--session-id\s+($sessionIdPattern)")
    if ($sessionIdMatch.Success) { return $sessionIdMatch.Groups[1].Value }
    $resumeMatch = [regex]::Match($CommandLine, "($sessionIdPattern)\.jsonl")
    if ($resumeMatch.Success) { return $resumeMatch.Groups[1].Value }
    return ""
}

# A pid alone is ambiguous across reuse, so incarnation is pid + process start.
function Resolve-ProcessIncarnationKey {
    param($ProcessRow)
    $startedTicks = 0
    if ($ProcessRow.CreationDate) { $startedTicks = ([datetime]$ProcessRow.CreationDate).Ticks }
    return "{0}:{1}" -f [int]$ProcessRow.ProcessId, $startedTicks
}

function ConvertTo-ProcessEntry {
    param($ProcessRow, [int]$CommandMaxChars, [bool]$IncludeCommand = $true)
    $entry = [ordered]@{
        pid         = [int]$ProcessRow.ProcessId
        ppid        = [int]$ProcessRow.ParentProcessId
        parentAlive = [bool]$livePids[[int]$ProcessRow.ParentProcessId]
        name        = $ProcessRow.Name
        privMb      = [math]::Round($ProcessRow.PrivatePageCount / 1MB, 1)
        wsMb        = [math]::Round($ProcessRow.WorkingSetSize / 1MB, 1)
    }
    $sessionId = Resolve-ClaudeSessionId $ProcessRow.CommandLine
    if ($sessionId) { $entry.sessionId = $sessionId }
    if ($IncludeCommand -and $ProcessRow.CommandLine) {
        $entry.cmd = $ProcessRow.CommandLine.Substring(
            0, [Math]::Min($CommandMaxChars, $ProcessRow.CommandLine.Length))
    }
    return $entry
}

$rankedProcesses = $allProcesses | Sort-Object PrivatePageCount -Descending
$trackedPids = @{}
$sampledProcesses = New-Object System.Collections.ArrayList
foreach ($processRow in ($rankedProcesses | Select-Object -First $TopN)) {
    if (-not $trackedPids[[int]$processRow.ProcessId]) {
        $trackedPids[[int]$processRow.ProcessId] = $true
        $sampledProcesses.Add($processRow) | Out-Null
    }
}
foreach ($processRow in $rankedProcesses) {
    if ($AlwaysTrackedProcessNames -contains $processRow.Name -and -not $trackedPids[[int]$processRow.ProcessId]) {
        $trackedPids[[int]$processRow.ProcessId] = $true
        $sampledProcesses.Add($processRow) | Out-Null
    }
}
# Heaviest-first ordering above means a runaway process count sheds the least
# interesting entries rather than blowing the per-sample size budget.
if ($sampledProcesses.Count -gt $MaxProcessEntriesPerSample) {
    $sampledProcesses = $sampledProcesses | Select-Object -First $MaxProcessEntriesPerSample
}

# A command line never changes for the life of a process, so re-emitting it every
# minute was 57% of every log file. It is written on an incarnation's first
# sighting only; readers resolve a bare entry from the newest earlier entry with
# the same pid that carried one. Losing the ledger only re-emits, never corrupts.
$commandLedgerFile = Join-Path $LogDir ("memwatch-{0:yyyyMMdd}.seen" -f $now)
$loggedIncarnations = New-Object 'System.Collections.Generic.HashSet[string]'
if (Test-Path $commandLedgerFile) {
    try {
        foreach ($ledgerLine in [System.IO.File]::ReadAllLines($commandLedgerFile)) {
            if ($ledgerLine) { $loggedIncarnations.Add($ledgerLine) | Out-Null }
        }
    } catch { $loggedIncarnations.Clear() }
}

$newIncarnations = New-Object System.Collections.ArrayList
$sampleEntries = @(foreach ($processRow in $sampledProcesses) {
        $incarnationKey = Resolve-ProcessIncarnationKey $processRow
        $isFirstSighting = -not $loggedIncarnations.Contains($incarnationKey)
        if ($isFirstSighting) { $newIncarnations.Add($incarnationKey) | Out-Null }
        ConvertTo-ProcessEntry $processRow 180 $isFirstSighting
    })

$sampleLine = [ordered]@{
    at        = $now.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    commitPct = $commitPct
    commitGb  = $commitGb
    freeRamGb = $freeRamGb
    top       = $sampleEntries
}
$sampleFile = Join-Path $LogDir ("memwatch-{0:yyyyMMdd}.jsonl" -f $now)
Add-Content -Path $sampleFile -Value ($sampleLine | ConvertTo-Json -Compress -Depth 4)
if ($newIncarnations.Count -gt 0) { Add-Content -Path $commandLedgerFile -Value $newIncarnations }

$tripStateFile = Join-Path $LogDir "trip-state.json"
$armed = $true
if (Test-Path $tripStateFile) {
    try { $armed = [bool](Get-Content $tripStateFile -Raw | ConvertFrom-Json).armed } catch { $armed = $true }
}

if (($commitPct -ge $TripCommitPct -or $ForceTrip) -and $armed) {
    # The snapshot is the post-mortem's ground truth, so it carries every process
    # and every command line regardless of what the sample line deduplicated.
    $snapshot = [ordered]@{
        at        = $sampleLine.at
        commitPct = $commitPct
        commitGb  = $commitGb
        freeRamGb = $freeRamGb
        processes = @(foreach ($processRow in $rankedProcesses) { ConvertTo-ProcessEntry $processRow 400 $true })
    }
    $snapshotFile = Join-Path $LogDir ("memsnapshot-{0:yyyyMMdd-HHmmss}.json" -f $now)
    Set-Content -Path $snapshotFile -Value ($snapshot | ConvertTo-Json -Depth 4)

    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $toastXml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
            [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $toastTextNodes = $toastXml.GetElementsByTagName("text")
        $toastTextNodes.Item(0).AppendChild($toastXml.CreateTextNode("Memory tripwire: commit at $commitPct%")) | Out-Null
        $toastTextNodes.Item(1).AppendChild($toastXml.CreateTextNode("Full process snapshot: $snapshotFile")) | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("MuggleMemwatch").Show(
            [Windows.UI.Notifications.ToastNotification]::new($toastXml))
    } catch {
        # Toast is best-effort; the snapshot is the deliverable.
    }
    $armed = $false
} elseif ($commitPct -lt $RearmCommitPct) {
    $armed = $true
}

Set-Content -Path $tripStateFile -Value ([ordered]@{
        armed      = $armed
        updated_at = $sampleLine.at
    } | ConvertTo-Json)

function Remove-SampleDay {
    param([string]$SampleFilePath)
    Remove-Item $SampleFilePath -Force -Confirm:$false -ErrorAction SilentlyContinue
    $ledgerPath = [System.IO.Path]::ChangeExtension($SampleFilePath, ".seen")
    Remove-Item $ledgerPath -Force -Confirm:$false -ErrorAction SilentlyContinue
}

$sampleCutoff = $now.AddDays(-$SampleRetentionDays)
foreach ($expiredSample in (Get-ChildItem $LogDir -Filter "memwatch-*.jsonl" |
            Where-Object { $_.LastWriteTime -lt $sampleCutoff })) {
    Remove-SampleDay $expiredSample.FullName
}
$snapshotCutoff = $now.AddDays(-$SnapshotRetentionDays)
Get-ChildItem $LogDir -Filter "memsnapshot-*.json" | Where-Object { $_.LastWriteTime -lt $snapshotCutoff } |
    Remove-Item -Force -Confirm:$false

# Age-based retention alone cannot bound the directory: one runaway day can
# outgrow a fortnight of normal ones. Oldest sample days are evicted until the
# directory fits, sparing today's file and the tripwire snapshots — those are the
# incident evidence, and they are orders of magnitude smaller than the samples.
$logDirBudgetBytes = $LogDirBudgetMb * 1MB
$evictableSamples = New-Object System.Collections.Queue
Get-ChildItem $LogDir -Filter "memwatch-*.jsonl" |
    Where-Object { $_.FullName -ne $sampleFile } |
    Sort-Object LastWriteTime |
    ForEach-Object { $evictableSamples.Enqueue($_.FullName) }
while ($evictableSamples.Count -gt 0 -and
    ((Get-ChildItem $LogDir -Recurse -File | Measure-Object Length -Sum).Sum -gt $logDirBudgetBytes)) {
    Remove-SampleDay $evictableSamples.Dequeue()
}
