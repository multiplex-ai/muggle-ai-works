# `watcherLifetime`

How long a `muggle-pr-followup` watch loop polls before retiring itself.

**Not gated.** This is a configuration value — no Picker 1, no silent footer. Nothing prompts; the saved value is read when a watch is armed. The `muggle-preferences` skill exposes it through Configure and Set so users can change it.

| Value | Lifetime |
|:------|:---------|
| `1d` | 86400s |
| `7d` | 604800s — default |
| `never` | Unbounded |

## Why a bound exists

A watch loop is a detached process. On Windows it survives the session that launched it, so an abandoned loop keeps polling the provider indefinitely. `watcher_superseded` retires one only when a *newer* arm claims the same slot, which never happens if nothing re-arms, so a time-based bound is needed.

Under a monitor that bound is `MUGGLE_PR_WATCH_MONITOR_WINDOW`, not this value. Arming runs the loop under a monitor, and the loop ends itself after the window (1740s) so it never outlives the monitor reading its output; an abandoned loop therefore retires within about 29 minutes, well before `1d` or `7d`. This lifetime bounds a loop run with the window disabled.

**`never` removes this bound.** Under a monitor the window still retires the loop; a loop run outside one then polls until the machine restarts or someone kills it.

## Applying it

The loop is plain `sh` and cannot read preferences. Resolve this value at arm time, convert it to seconds, and export `MUGGLE_PR_WATCH_MAX_LIFETIME` into the loop's environment. `never` exports `0`, which the guard library reads as unbounded.

An already-set `MUGGLE_PR_WATCH_MAX_LIFETIME` wins and is never overwritten, so an operator can pin any value without changing the preference.
