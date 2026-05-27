# `muggle-do:cycle`

One per address-reviews invocation, regardless of outcome.

```json
{
  "skill": "muggle-do",
  "event": "cycle",
  "session_slug": "<slug>",
  "repo": "<owner>/<repo>",
  "pr_number": <int>,
  "review_ids_in": [<int>, ...],
  "review_ids_actionable": [<int>, ...],
  "review_ids_ambiguous": [<int>, ...],
  "head_sha_before": "<sha-or-null>",
  "head_sha_after": "<sha-or-null>",
  "outcome": "pushed" | "escalated" | "mixed" | "no-op" | "self-loop-skip"
}
```

`outcome`:
- `"pushed"` — at least one actionable, no ambiguous, push succeeded.
- `"escalated"` — all reviews were ambiguous; no push.
- `"mixed"` — both branches happened in the same invocation.
- `"no-op"` — every input id was already in the escalated set; no work.
- `"self-loop-skip"` — review was a synthetic wrapper around the agent's own reply (every line comment is a reply carrying the loop marker `<!-- muggle-do:bot -->`). Cursor advanced silently; no work, no escalation.
