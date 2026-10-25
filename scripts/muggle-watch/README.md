# muggle watch service

A standing per-user scheduled task that runs `muggle watch tick` every few minutes, outside any agent session. Each tick:

- **Tracks** active Claude Code sessions (`claude agents --json`) and Codex sessions (recent `~/.codex/sessions` rollouts). It also tracks their processes: claude, codex, muggle MCP servers, and PR watch loops.
- **Checks every open PR-watch slot** under `~/.muggle-ai/muggle-do/sessions/`. Is its loop running, and heard by a live session? Is CI red? Is the branch behind or conflicting? Are review threads unresolved?
- **Keeps registered watchers running.** A slot carrying `watch-registration.json` (written by `pr-watch-arm.sh` on every arm) has its owner session resumed in the background when its loop is gone and the owner is down. The resumed session's `/muggle:muggle-pr-followup reconcile` re-arms it with that session's own context. The service never addresses a review, pushes, or kills a process.
- **Fans plugin reloads out.** When the user-scope plugins in `~/.claude/plugins/installed_plugins.json` change, idle background sessions are respawned (`claude respawn`), up to 3 per tick. Busy ones wait for a later tick, and terminal sessions get one notification to run `/reload-plugins`. No interface runs a slash command inside another session.
- **Records and alerts.** Results go to `status.json` (last snapshot), `state.json` (active findings, recovery attempts, plugin fingerprint) and `events.jsonl` (raise/clear/resume/respawn history) under `~/.muggle-ai/watch/`. New alerts raise one desktop notification per tick.

## Install (Windows)

Requires the global package (`npm install -g @muggleai/works`), plus `claude` and `gh` on PATH.

```powershell
& "$(npm root -g)\@muggleai\works\scripts\muggle-watch\install-muggle-watch.ps1"
```

| Flag | Effect |
| :--- | :----- |
| `-IntervalMinutes <n>` | Tick interval, default 2 |
| `-NoRecovery` | Report dead watchers without resuming their owners |
| `-NoAutoReload` | Never start a reload fan-out on a plugin change |
| `-MuggleEntry <path>` | Run a specific `bin\muggle.js` instead of the global install |
| `-Uninstall` | Remove the task; the ledger is kept |

Re-running the installer replaces the task in place. The task runs `wscript.exe` on a copied shim, so no console window flashes. Its output goes to `~/.muggle-ai/watch/tick.log`.

## macOS / Linux

There is no installer yet. Add a crontab line:

```sh
*/2 * * * * muggle watch tick >> ~/.muggle-ai/watch/tick.log 2>&1
```

## Commands

```sh
muggle watch status            # last snapshot: sessions, processes, PR watches, findings
muggle watch tick              # one pass now
muggle watch reload-plugins    # reload plugins across sessions now (--dry-run to preview)
muggle watch register --slot <dir>    # opt a slot into recovery
muggle watch unregister --slot <dir>  # keep a slot session-scoped
```
