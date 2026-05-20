# `muggle-pr-followup:tick`

One per watcher iteration (idle or not).

```json
{
  "skill": "muggle-pr-followup",
  "event": "tick",
  "session_slug": "<slug>",
  "repo": "<owner>/<repo>",
  "pr_number": <int>,
  "reviews_seen": <int>,
  "dispatched_review_ids": [<int>, ...],
  "terminal": true | false,
  "idle": true | false,
  "tick_duration_ms": <int>
}
```

- `reviews_seen`: count of new submitted reviews past the cursor, **after** filtering by the escalated set.
- `dispatched_review_ids`: review ids handed to `/muggle-do`. Empty when idle.
- `terminal`: true when this tick observed the PR merged or closed and wrote `result.md`.
- `idle`: true when no reviews were dispatched this tick.
