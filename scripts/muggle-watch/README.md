# muggle watch service

A standing per-user scheduled job that runs `muggle watch tick` every few minutes, outside any agent session, on Windows, macOS and Linux. Each tick:

- **Tracks** active Claude Code sessions (`claude agents --json`) and Codex sessions (recent `~/.codex/sessions` rollouts). It also tracks their processes: claude, codex, muggle MCP servers, and PR watch loops. Each live Claude session is stamped with when it last loaded its plugins (its process start, or its newest muggle MCP server start after a `/reload-plugins`) and the muggle works build installed then, read off `~/.muggle-ai/postinstall.log`.
- **Checks every open PR-watch slot** under `~/.muggle-ai/muggle-do/sessions/`. Is its loop running, and heard by a live session? Is CI red? Is the branch behind or conflicting? Are review threads unresolved?
- **Keeps registered watchers running.** A slot carrying `watch-registration.json` (written by `pr-watch-arm.sh` on every arm) whose loop is dead or unheard gets a loop the service starts itself, as a program outside every session. When that loop reports new activity or the PR ending, the owner session is woken with `/muggle:muggle-pr-followup <slug> <n> --wake=<event|terminal>` for that one PR, but only between its turns. The service never addresses a review, pushes, or pushes anything else into a session.
- **Closes out finished slots.** A slot whose PR GitHub reports merged or closed, with no loop and no running owner, is finalized the way a watcher's terminal tick would: `prs.json` takes the state, `followup.log` the terminal line, and `result.md` is written. Only local files change; post-merge cleanup is left to a session and recorded as not run.
- **Keeps sessions on the installed build.** A session loaded before the newest global install (or a later user-scope update of the muggle plugin) is behind; other plugins updating restart nothing. Idle background sessions are respawned onto the new build, up to 3 per tick, keeping their own id and name. A session that owns open PR watches is left running. Before a restart, a throwaway background launch in the session's workspace confirms Claude will bring it back; a workspace that refuses is left running and named once. Busy or waiting sessions wait for a later tick, and terminal sessions get one notification to run `/reload-plugins`. No interface runs a slash command inside another session.
- **Keeps sessions on Remote Control.** With `remoteControlAtStartup` on in Claude's settings, a live background session is off when its `~/.claude/sessions/<pid>.json` entry has no Remote Control link, or its process started before the current claude.ai login took effect, so its link serves another account. Such a session is respawned once its turn is over (registry status `idle` or `shell`), sharing the 3-per-tick cap with the reload. That keeps the same session id, so there is no duplicate in the agent view, and nothing is typed into it. Background commands carry over to the restarted process, PR watch loops included, so they keep reporting to that session. Each restart opens a new Remote Control session, so a session already on is never restarted. A restarted session gets 30 minutes to link, and one still off after 2 restarts in a day is left alone. Terminal sessions that are off are listed for `/remote-control`.
- **Records and alerts.** Results go to `status.json` (last snapshot, with open-PR and Remote Control coverage), `state.json` (active findings, recovery attempts, reload progress, the login last seen, Remote Control restarts) and `events.jsonl` (raise/clear/resume/respawn/close-out history) under `~/.muggle-ai/watch/`. New alerts raise one desktop notification per tick.

## Install

Requires the global package (`npm install -g @muggleai/works`), plus `claude` and `gh` on PATH. The same command works on every platform:

```sh
muggle watch install              # schedule it and run one tick now
muggle watch install --no-wait    # schedule it only; the first tick follows within the interval
muggle watch install --uninstall  # remove it; the ledger is kept
```

The `autoInstallWatchService` preference (asked by `muggle init` and `/muggle-upgrade`) makes this automatic: on `always` every global install or upgrade schedules the watch, and a watch already scheduled is refreshed on any value but `never`.

| Platform | Scheduler | Entry | Output |
| :------- | :-------- | :---- | :----- |
| Windows | Task Scheduler | task `MuggleWatch`, via `wscript.exe` on a copied shim, so no console window flashes | `~/.muggle-ai/watch/tick.log` |
| macOS | launchd | agent `ai.muggle.watch` in `~/Library/LaunchAgents` | `~/.muggle-ai/watch/tick.log` |
| Linux | systemd user timer | `muggle-watch.service` + `.timer` in `$XDG_CONFIG_HOME/systemd/user` | `~/.muggle-ai/watch/tick.log` |
| Linux without a systemd user session (containers, BSDs) | cron | one crontab line ending `# muggle-watch` | `~/.muggle-ai/watch/tick.log` |

Re-installing replaces the entry in place. On macOS and Linux every scheduler runs one copied launcher, `~/.muggle-ai/watch/bin/muggle-watch-tick.sh`. Schedulers start jobs with a minimal PATH, so the launcher restores the PATH of the shell that ran the install from `watch-env.sh` beside it. Re-run the install after `claude`, `gh` or `node` moves. The log is capped at 1 MB on every platform.

A systemd user timer runs only while you are logged in. On a headless machine, `loginctl enable-linger $USER` keeps it running after logout.

On Windows the PowerShell installer also takes flags directly:

```powershell
& "$(npm root -g)\@muggleai\works\scripts\muggle-watch\install-muggle-watch.ps1" -IntervalMinutes 5
```

| Flag | Effect |
| :--- | :----- |
| `-IntervalMinutes <n>` | Tick interval, default 2 |
| `-NoRecovery` | Report dead watchers without resuming their owners |
| `-NoAutoReload` | Never restart sessions onto a new build |
| `-NoRemoteControl` | Report sessions off Remote Control without restarting them |
| `-NoWait` | Return once the task is registered, before its first tick |
| `-MuggleEntry <path>` | Run a specific `bin\muggle.js` instead of the global install |
| `-Uninstall` | Remove the task; the ledger is kept |

## Commands

```sh
muggle watch status            # last snapshot: sessions and their builds, processes, PR watches, coverage, findings
muggle watch tick              # one pass now
muggle watch reload-plugins    # restart every idle session onto the plugins on disk now (--dry-run to preview)
muggle watch install           # schedule the watch or refresh it in place (--uninstall, --no-wait)
muggle watch register --slot <dir>    # opt a slot into recovery
muggle watch unregister --slot <dir>  # keep a slot session-scoped
```
