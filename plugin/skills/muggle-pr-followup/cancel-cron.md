# Cancel the watcher's cron

Deletes this slot's watcher cron, and nothing more — the caller owns whatever comes next (respawn or terminal teardown). Used by the stale-fire guard and terminal unschedule ([`finalize.md`](finalize.md) Step 4) and each single-thread "stop this watcher" before a `/muggle-do` dispatch ([`contract.md`](contract.md) Steps 4–6).

> **`CronList` and `CronDelete` are Claude Code tool calls, not shell commands.** Invoke them directly through the tool system. Never wrap them in a Bash/shell call: `bash -c "CronDelete …"` fails with "command not found", which a `2>/dev/null` on the line swallows, so the delete silently no-ops and the per-minute cron keeps firing — every later tick hits the stale-fire guard and re-fires until the 7-day expiry.

Two lookups, recorded-id first so the delete still works when `CronList` has gone blind to the cron (survived a session continue / compaction — see [`state-schemas.md`](state-schemas.md#cronjson)):

1. **By recorded id.** Read `cron.json` ([`state-schemas.md`](state-schemas.md#cronjson)). If `cron_id` is non-null, call `CronDelete` with it. This is the only handle that survives `CronList` blindness.
2. **By `CronList` match (fallback).** Call `CronList`, find the job whose command ends with `/muggle:muggle-pr-followup <slug> <n>` — the exact two-arg match for this slot's PR — and `CronDelete` its id. This catches a stale recorded id (a since-respawned cron whose new id no tick has recorded yet) and the case where `cron.json` is absent.

Both lookups are no-ops when nothing matches — a manually-run tick, or a cron that already expired. Deleting an already-gone id is harmless. Do **not** delete `cron.json` itself here; a terminal slot keeps it as a record, and reconcile ([`reconcile.md`](reconcile.md)) may still read it to sweep a straggler.
