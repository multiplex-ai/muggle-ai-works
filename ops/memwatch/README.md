# memwatch — memory-exhaustion flight recorder

Captures the context a memory-leak post-mortem needs: who held the memory, their parentage, and the growth timeline. Born from the 2026-07-26 exhaustion freeze, where Windows' own Resource-Exhaustion-Detector OOM'd before recording any of it.

## Components

| Piece | Needs admin | What it captures |
| :---- | :---------- | :--------------- |
| `memwatch.ps1` (scheduled task, 1/min, no window) | no | JSON line per minute: commit %, free RAM, top-15 processes by private bytes plus every `claude.exe` whatever its rank, each with pid/ppid/parent-alive/session id/command line. Tripwire at 85% commit: full process snapshot + toast, re-arms below 75%. |
| perfmon flight recorder (`logman`, via `install-elevated.ps1`) | yes | 30s circular counter log (512 MB cap): system commit + per-process Private Bytes / Working Set. Open the `.blg` in perfmon after a crash. |
| process-creation audit (via `install-elevated.ps1`) | yes | Security event 4688 per process birth, including command line — names who spawned what after processes die. CLI-passed secrets land in the local Security log; accepted trade-off. |

## Install

```powershell
.\install-memwatch.ps1                                  # sampler task (current user)
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',"$PWD\install-elevated.ps1"
```

`install-memwatch.ps1` copies the sampler and `memwatch-hidden.vbs` to `~\.muggle-ai\memwatch\bin\` so the task survives checkout deletion. The elevated installer writes `~\.muggle-ai\memwatch\install-elevated-result.json` for verification from an unelevated shell.

The task's action is `wscript.exe memwatch-hidden.vbs`, not `powershell.exe`. Windows allocates a console at process creation for a console-subsystem binary, so `-WindowStyle Hidden` only hides a window that has already been painted — 1440 visible flashes a day. `wscript.exe` is GUI-subsystem and spawns the sampler hidden from the start. An S4U task principal would hide it too, but registering one needs elevation and its non-interactive station drops the tripwire toast.

## Pause / resume

Turn the sampler off or on without unregistering it — samples and `trip-state.json` are kept:

```powershell
.\toggle-memwatch.ps1 -Off    # pause the per-minute sampler
.\toggle-memwatch.ps1 -On     # resume it
.\toggle-memwatch.ps1         # show current state / last run
```

`-Off` disables the scheduled task, `-On` re-enables it — both unprivileged. This is the reversible switch; to remove the task entirely instead, see [Uninstall](#uninstall). The elevated flight-recorder and audit pieces are not covered by this switch (they have no per-user disable) — manage them via their own commands in Uninstall.

## Data locations

All under `~\.muggle-ai\memwatch\`: `memwatch-YYYYMMDD.jsonl` (samples, 14-day retention), `memwatch-YYYYMMDD.seen` (that day's command-line ledger, evicted with its samples), `memsnapshot-*.json` (tripwire dumps, 90-day retention), `flight\memflight*.blg` (circular), `trip-state.json`.

Age is not a size bound on its own — one runaway day can outgrow a fortnight of quiet ones — so the sampler also evicts whole sample days, oldest first, until the directory fits `-LogDirBudgetMb` (default 100). The current day's file and every snapshot are exempt: snapshots are the incident evidence and are orders of magnitude smaller than the samples.

## Reading a post-mortem

1. `memwatch-*.jsonl` around the incident: growth curve + top consumers per minute (`parentAlive: false` on a heavy process = orphaned work).
2. `memsnapshot-*.json`: full process table at the 85% crossing, every command line spelled out.

A command line never changes for the life of a process, so `cmd` is written on an incarnation's first sighting only — re-emitting it each minute was 57% of every file. Resolve a bare entry from the newest earlier entry with the same `pid` that carries one; a reused pid re-emits, so that lookup can never cross incarnations. `sessionId` stays on every entry, so grepping a session id still hits every sample it appears in.
3. `relog flight\memflight*.blg -f csv -o out.csv` (or perfmon) for per-process counter history.
4. Security log 4688 events: spawn tree with command lines.

## Uninstall

Full removal. To only pause the sampler (reversible), use [Pause / resume](#pause--resume) instead.

```powershell
Unregister-ScheduledTask MuggleMemwatch -Confirm:$false
logman stop muggle-memflight; logman delete muggle-memflight   # elevated
schtasks /Delete /F /TN MuggleMemflightBoot                    # elevated
auditpol /set /subcategory:"{0CCE922B-69AE-11D9-BED3-505054503030}" /success:disable  # elevated
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit" /v ProcessCreationIncludeCmdLine_Enabled /f  # elevated
```
