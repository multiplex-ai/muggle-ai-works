# Cancel the watcher's cron

Deletes this slot's watcher cron, and nothing more — the caller owns whatever comes next (respawn or terminal teardown). Used by the stale-fire guard and terminal unschedule ([`finalize.md`](finalize.md) Step 4) and each single-thread "stop this watcher" before a `/muggle-do` dispatch ([`contract.md`](contract.md) Steps 4–6).

> **`CronList` and `CronDelete` are Claude Code tool calls, not shell commands.** Invoke them directly through the tool system. Never wrap them in a Bash/shell call: `bash -c "CronDelete …"` fails with "command not found", which a `2>/dev/null` on the line swallows, so the delete silently no-ops and the per-minute cron keeps firing — every later tick hits the stale-fire guard and re-fires until the 7-day expiry.

Two lookups, recorded-id first so the delete still works when `CronList` has gone blind to the cron (survived a session continue / compaction — see [`state-schemas.md`](state-schemas.md#cronjson)):

1. **By recorded id.** Read `cron.json` ([`state-schemas.md`](state-schemas.md#cronjson)). If `cron_id` is non-null, call `CronDelete` with it. This is the only handle that survives `CronList` blindness. It **finds** a cron when the id names a live scheduled cron the delete removes; a `cron_id` that is null or already gone is a harmless no-op that finds nothing.
2. **By `CronList` match (fallback).** Call `CronList`, find the job whose command ends with `/muggle:muggle-pr-followup <slug> <n>` — the exact two-arg match for this slot's PR — and `CronDelete` its id. This catches a stale recorded id (a since-respawned cron whose new id no tick has recorded yet) and the case where `cron.json` is absent. It **finds** a cron when the match surfaces a live job to delete; an empty `CronList` (already blind) or no matching job finds nothing.

**Reported result — `found` or `not-found`.** cancel-cron reports **found** when either lookup located and cancelled a live cron: the cron was reachable in this runtime, so any stale fires that follow are just the finite queued-drain backlog emptying. It reports **not-found** when both lookups found nothing to cancel. A **not-found** that keeps recurring — the cron fires again yet no cancel can reach it — is the orphan signal the stale-fire guard keys on ([`contract.md`](contract.md) Step 0). Callers that only tear down (finalize [`finalize.md`](finalize.md), the single-thread stops in [`contract.md`](contract.md) Steps 4–6) do not branch on the result; only Step 0's orphan gate consults it. Deleting an already-gone id is harmless either way.

Do **not** delete `cron.json` itself here; a terminal slot keeps it as a record, and reconcile ([`reconcile.md`](reconcile.md)) may still read it to sweep a straggler.
