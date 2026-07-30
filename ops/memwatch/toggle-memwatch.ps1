# On/off switch for the MuggleMemwatch sampler task. Wraps Enable/Disable so the
# tracker can be paused mid-investigation without unregistering it — samples and
# trip-state survive, and -On resumes on the next minute. Unprivileged (the task
# is registered per-user); PowerShell 5.1-compatible. The elevated flight-recorder
# and audit pieces are not covered here — see README "Uninstall" for those.
[CmdletBinding(DefaultParameterSetName = 'Status')]
param(
    [Parameter(ParameterSetName = 'On', Mandatory)][switch]$On,
    [Parameter(ParameterSetName = 'Off', Mandatory)][switch]$Off,
    [string]$TaskName = 'MuggleMemwatch'
)

$ErrorActionPreference = 'Stop'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
    if ($On) {
        Write-Warning "$TaskName is not installed — run install-memwatch.ps1 first to register it."
        exit 1
    }
    Write-Output "$TaskName is not installed (nothing to toggle)."
    exit 0
}

switch ($PSCmdlet.ParameterSetName) {
    'On' {
        Enable-ScheduledTask -TaskName $TaskName | Out-Null
        Write-Output "$TaskName enabled — sampling resumes within a minute."
    }
    'Off' {
        Disable-ScheduledTask -TaskName $TaskName | Out-Null
        Write-Output "$TaskName disabled — sampler paused; samples and trip-state kept. Re-enable with -On."
    }
    'Status' {
        $info = $task | Get-ScheduledTaskInfo
        Write-Output "$TaskName state: $($task.State)"
        Write-Output "  last run: $($info.LastRunTime) (result $($info.LastTaskResult))"
        Write-Output "  next run: $($info.NextRunTime)"
    }
}
