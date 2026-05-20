# `muggle-do:escalation`

Zero or one per address-reviews invocation. Fires when `/muggle-do` emits a terminal escalation message to the user.

```json
{
  "skill": "muggle-do",
  "event": "escalation",
  "session_slug": "<slug>",
  "repo": "<owner>/<repo>",
  "pr_number": <int>,
  "kind": "ambiguous-review" | "design-adjustment",
  "review_ids": [<int>, ...]
}
```

`kind`:
- `"ambiguous-review"` — one or more reviews classified ambiguous in this batch.
- `"design-adjustment"` — mid-cycle, the work surfaced a design-level conflict.
