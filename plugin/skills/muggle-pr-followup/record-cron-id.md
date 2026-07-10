# Record the watcher's cron id

The self-record every tick runs so this slot's cron stays deletable after `CronList` goes blind to it. `CronList` stops enumerating a `/loop` cron once its session is continued or compacted, but the cron keeps firing; a cron id captured to `cron.json` **while the cron was still visible** remains a valid `CronDelete` target for teardown ([`cancel-cron.md`](cancel-cron.md), [`finalize.md`](finalize.md), [`reconcile.md`](reconcile.md)). Recording early — every tick, starting with the first — is what makes the id durable.

> **`CronList` is a Claude Code tool call, not a shell command.** Invoke it through the tool system. Never wrap it in Bash.

1. Call the `CronList` tool.
2. Find the job whose command ends with `/muggle:muggle-pr-followup <slug> <n>` — the exact two-arg match for this slot's PR.
3. If found and its id differs from `cron.json.cron_id`: rewrite `cron.json` (whole-file Write per [`../_shared/session-state-writes.md`](../_shared/session-state-writes.md)) with the observed `cron_id`, the current `interval`, and a fresh `recorded_at`.
4. If `CronList` returns nothing (already blind) and `cron.json` holds a non-null `cron_id`: **leave it** — the previously-recorded id is the only handle left, so never overwrite it with `null`.

Skip in the stale-fire path ([`contract.md`](contract.md) Step 0): a stale slot is being torn down, not re-recorded.
