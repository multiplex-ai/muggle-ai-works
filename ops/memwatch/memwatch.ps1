# Per-minute memory sampler + commit tripwire. Runs from the MuggleMemwatch
# scheduled task (see install-memwatch.ps1); PowerShell 5.1-compatible.
[CmdletBinding()]
param(
    [string]$LogDir = (Join-Path $env:USERPROFILE ".muggle-ai\memwatch"),
    [int]$TopN = 15,
    [double]$TripCommitPct = 85,
    [double]$RearmCommitPct = 75,
    [int]$RetentionDays = 14,
    [switch]$ForceTrip
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$now = Get-Date

$counterSamples = (Get-Counter '\Memory\% Committed Bytes In Use', '\Memory\Committed Bytes').CounterSamples
$commitPct = [math]::Round(($counterSamples | Where-Object { $_.Path -like '*% committed*' })[0].CookedValue, 1)
$commitGb = [math]::Round(($counterSamples | Where-Object { $_.Path -like '*committed bytes' })[0].CookedValue / 1GB, 2)
$osInfo = Get-CimInstance Win32_OperatingSystem
$freeRamGb = [math]::Round($osInfo.FreePhysicalMemory / 1MB, 2)

$allProcesses = Get-CimInstance Win32_Process |
    Select-Object ProcessId, ParentProcessId, Name, PrivatePageCount, WorkingSetSize, CommandLine
$livePids = @{}
foreach ($processRow in $allProcesses) { $livePids[[int]$processRow.ProcessId] = $true }

function ConvertTo-ProcessEntry {
    param($ProcessRow, [int]$CommandMaxChars)
    $command = ""
    if ($ProcessRow.CommandLine) {
        $command = $ProcessRow.CommandLine.Substring(0, [Math]::Min($CommandMaxChars, $ProcessRow.CommandLine.Length))
    }
    return [ordered]@{
        pid         = [int]$ProcessRow.ProcessId
        ppid        = [int]$ProcessRow.ParentProcessId
        parentAlive = [bool]$livePids[[int]$ProcessRow.ParentProcessId]
        name        = $ProcessRow.Name
        privMb      = [math]::Round($ProcessRow.PrivatePageCount / 1MB, 1)
        wsMb        = [math]::Round($ProcessRow.WorkingSetSize / 1MB, 1)
        cmd         = $command
    }
}

$topProcesses = $allProcesses | Sort-Object PrivatePageCount -Descending | Select-Object -First $TopN
$sampleLine = [ordered]@{
    at        = $now.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    commitPct = $commitPct
    commitGb  = $commitGb
    freeRamGb = $freeRamGb
    top       = @(foreach ($processRow in $topProcesses) { ConvertTo-ProcessEntry $processRow 180 })
}
$sampleFile = Join-Path $LogDir ("memwatch-{0:yyyyMMdd}.jsonl" -f $now)
Add-Content -Path $sampleFile -Value ($sampleLine | ConvertTo-Json -Compress -Depth 4)

$tripStateFile = Join-Path $LogDir "trip-state.json"
$armed = $true
if (Test-Path $tripStateFile) {
    try { $armed = [bool](Get-Content $tripStateFile -Raw | ConvertFrom-Json).armed } catch { $armed = $true }
}

if (($commitPct -ge $TripCommitPct -or $ForceTrip) -and $armed) {
    $snapshot = [ordered]@{
        at        = $sampleLine.at
        commitPct = $commitPct
        commitGb  = $commitGb
        freeRamGb = $freeRamGb
        processes = @(
            foreach ($processRow in ($allProcesses | Sort-Object PrivatePageCount -Descending)) {
                ConvertTo-ProcessEntry $processRow 400
            }
        )
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

$sampleCutoff = $now.AddDays(-$RetentionDays)
Get-ChildItem $LogDir -Filter "memwatch-*.jsonl" | Where-Object { $_.LastWriteTime -lt $sampleCutoff } |
    Remove-Item -Force -Confirm:$false
$snapshotCutoff = $now.AddDays(-90)
Get-ChildItem $LogDir -Filter "memsnapshot-*.json" | Where-Object { $_.LastWriteTime -lt $snapshotCutoff } |
    Remove-Item -Force -Confirm:$false
