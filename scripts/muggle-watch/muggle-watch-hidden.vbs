' Console-free launcher for `muggle watch tick`, used as the MuggleWatch task action.
'
' node.exe is a console-subsystem binary, so launching it straight from the task
' paints a console window on every run. wscript.exe is GUI-subsystem, and the
' child it starts with intWindowStyle 0 is created hidden.
'
' Arguments: <node.exe> <muggle.js> [extra tick flags...]
'
' Output is appended to tick.log beside this script's install dir, capped at
' 1 MB by starting over, since the snapshot and events ledger are the record and
' the log only needs the recent failures. The Run call waits, so the task's
' IgnoreNew overlap guard and LastTaskResult describe the tick, not this shim.
Option Explicit

Const LOG_CAP_BYTES = 1048576

Dim fileSystem, windowsShell, watchDir, logPath, nodePath, muggleEntry, tickFlags, argumentIndex, tickExitCode
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set windowsShell = CreateObject("WScript.Shell")

If WScript.Arguments.Count < 2 Then WScript.Quit 2
nodePath = WScript.Arguments(0)
muggleEntry = WScript.Arguments(1)
tickFlags = ""
For argumentIndex = 2 To WScript.Arguments.Count - 1
    tickFlags = tickFlags & " " & WScript.Arguments(argumentIndex)
Next

watchDir = fileSystem.GetParentFolderName(fileSystem.GetParentFolderName(WScript.ScriptFullName))
logPath = watchDir & "\tick.log"
If fileSystem.FileExists(logPath) Then
    If fileSystem.GetFile(logPath).Size > LOG_CAP_BYTES Then fileSystem.DeleteFile logPath
End If

tickExitCode = windowsShell.Run( _
    "cmd.exe /d /s /c """"" & nodePath & """ """ & muggleEntry & """ watch tick" & tickFlags & " >> """ & logPath & """ 2>&1""", _
    0, True)

WScript.Quit tickExitCode
