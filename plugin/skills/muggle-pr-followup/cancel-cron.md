# Cancel the watcher's cron

The find-and-delete every tick uses to stop its own loop: the stale-fire guard and terminal unschedule ([`finalize.md`](finalize.md) Step 4), and each single-thread "stop this watcher" before a `/muggle-do` dispatch ([`contract.md`](contract.md) Steps 4–6).

> **`CronList` and `CronDelete` are Claude Code tool calls, not shell commands.** Invoke them directly through the tool system. Never wrap them in a Bash/shell call: `bash -c "CronDelete …"` fails with "command not found", which a `2>/dev/null` on the line swallows, so the delete silently no-ops and the per-minute cron keeps firing — every later tick hits the stale-fire guard and re-fires until the 7-day expiry.

1. Call the `CronList` tool.
2. Find the job whose command ends with `/muggle:muggle-pr-followup <slug> <n>` — the exact two-arg match for this slot's PR.
3. Call the `CronDelete` tool with that job's id.

No-op when none matches — a manually-run tick, or a cron that already expired.
