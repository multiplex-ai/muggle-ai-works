# `muggle-do:escalation`

Zero or one per address-reviews invocation, plus zero or one per forward cycle that waives a failing E2E run. Fires when `/muggle-do` emits a terminal escalation message to the user.

```json
{
  "skill": "muggle-do",
  "event": "escalation",
  "session_slug": "<slug>",
  "repo": "<owner>/<repo>",
  "pr_number": <int>,
  "kind": "ambiguous-review" | "design-adjustment" | "rebase-conflict" | "e2e-unrepairable",
  "review_ids": [<int>, ...]
}
```

`kind`:
- `"ambiguous-review"` — one or more reviews classified ambiguous in this batch.
- `"design-adjustment"` — mid-cycle, the work surfaced a design-level conflict.
- `"rebase-conflict"` — an opt-in auto-rebase hit conflicts that couldn't be resolved and verified; the branch was restored to its pre-rebase SHA. `review_ids` may be empty.
- `"e2e-unrepairable"` — the E2E repair loop shipped with failures it could not fix: the user waived, an unattended run had nobody to ask, or the iteration cap ran out. `review_ids` is empty.
