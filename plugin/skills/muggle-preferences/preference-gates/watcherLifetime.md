# `watcherLifetime`

How long a `muggle-pr-followup` watch loop polls before retiring itself.

**Not gated.** This is a configuration value — no Picker 1, no silent footer. Nothing prompts; the saved value is read when a watch is armed. The `muggle-preferences` skill exposes it through Configure and Set so users can change it.

| Value | Lifetime |
|:------|:---------|
| `1d` | 86400s |
| `7d` | 604800s — default |
| `never` | Unbounded |

## Why a bound exists

A watch loop is a detached process. On Windows it survives the session that launched it, so an abandoned loop keeps polling the provider indefinitely. This cap is the only **time-based** reaper for such a loop — `watcher_superseded` retires one only when a *newer* arm claims the same slot, which never happens if nothing re-arms.

**`never` removes that reaper.** It is a legitimate choice, since it ends the re-arm cycle entirely, but an orphaned loop then polls until the machine restarts or someone kills it.

## Applying it

The loop is plain `sh` and cannot read preferences. Resolve this value at arm time, convert it to seconds, and export `MUGGLE_PR_WATCH_MAX_LIFETIME` into the loop's environment. `never` exports `0`, which the guard library reads as unbounded.

An already-set `MUGGLE_PR_WATCH_MAX_LIFETIME` wins and is never overwritten, so an operator can pin any value without changing the preference.
