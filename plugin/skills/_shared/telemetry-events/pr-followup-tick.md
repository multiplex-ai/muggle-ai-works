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
