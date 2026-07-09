# `muggle-pr-followup:tick`

One per watcher iteration (idle or not).

```json
{
  "skill": "muggle-pr-followup",
  "event": "tick",
  "session_slug": "<slug>",
  "repo": "<owner>/<repo>",
  "pr_number": <int>,
  "actionable_threads": <int>,
  "dispatched_review_ids": [<int>, ...],
  "rebase_needed": true | false,
  "dispatched_rebase": true | false,
  "checks_red": <int>,
  "dispatched_ci_fix": true | false,
  "terminal": true | false,
  "idle": true | false,
  "blocked": true | false,
  "reminded": true | false,
  "interval": "1m" | "5m",
  "tick_duration_ms": <int>
}
```

- `actionable_threads`: count of actionable items this tick — unresolved, non-outdated threads whose newest comment is unmarked, plus body-only reviews past `lastBodyReviewId` — **after** filtering by the escalated set.
- `dispatched_review_ids`: owning review ids handed to `/muggle-do`. Empty when idle.
- `rebase_needed`: true when the branch is behind its base (`behind_by > 0`) or conflicting (`mergeable == CONFLICTING`). `false` when reviews were dispatched (reviews preempt the mergeability check).
- `dispatched_rebase`: true when this tick dispatched `/muggle-do` with a rebase directive.
- `checks_red`: count of failing checks on the head SHA. `0` when reviews or a rebase were dispatched (both preempt the CI poll) or CI was green/pending.
- `dispatched_ci_fix`: true when this tick dispatched `/muggle-do` with a fix-ci directive.
- `terminal`: true when this tick observed the PR merged or closed and wrote `result.md`.
- `idle`: true when nothing was dispatched this tick.
- `blocked`: true on a tick that idled on a durable human-block (escalated rebase/CI, or an ambiguous review awaiting the user) and emitted the one-line owner reminder. `false` on the tick the block clears and on every normal tick. Always accompanies `idle: true`. While blocked the cadence backs off to `5m` (`interval: "5m"`); it returns to `1m` the moment the block clears — the watcher slows to remind, never stops.
- `reminded`: true when this tick emitted the one-line blocked reminder to the owner (every `blocked: true` tick does). `false` otherwise.
- `interval`: the poll cadence this tick fired at — `"5m"` on a blocked tick (the poll is slowed while awaiting the owner), `"1m"` otherwise. Mirrors `cron.json.interval`.
