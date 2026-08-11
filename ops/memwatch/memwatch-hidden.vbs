' Console-free launcher for memwatch.ps1, used as the MuggleMemwatch task action.
'
' powershell.exe is a console-subsystem binary: Windows allocates its console at
' process creation, so -WindowStyle Hidden only hides a window that has already
' been painted — a visible flash on every one of the 1440 daily runs. wscript.exe
' is GUI-subsystem, so the child it spawns with intWindowStyle 0 is never shown.
' An S4U task principal would also avoid the console, but registering one needs
' elevation and its non-interactive station silently drops the tripwire toast.
'
' The Run call waits: the task's IgnoreNew overlap guard and LastTaskResult both
' read the action's own lifetime, which a fire-and-forget launcher would end
' immediately while the sampler was still running.
Option Explicit

Dim windowsShell, samplerPath, samplerExitCode
Set windowsShell = CreateObject("WScript.Shell")
samplerPath = CreateObject("Scripting.FileSystemObject") _
    .GetParentFolderName(WScript.ScriptFullName) & "\memwatch.ps1"

samplerExitCode = windowsShell.Run( _
    "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & samplerPath & """", _
    0, True)

WScript.Quit samplerExitCode
