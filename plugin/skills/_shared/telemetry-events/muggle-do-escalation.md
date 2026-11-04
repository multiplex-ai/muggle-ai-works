# `muggle-do:escalation`

Zero or one per address-reviews invocation, plus zero or one per forward cycle that waives a failing E2E run or leaves its decision open. Fires when `/muggle-do` emits a terminal escalation message to the user.

```json
{
  "eventType": "muggle-do:escalation",
  "skillName": "muggle-do",
  "metadata": {
    "session_slug": "<slug>",
    "repo": "<owner>/<repo>",
    "pr_number": <int>,
    "kind": "ambiguous-review" | "design-adjustment" | "rebase-conflict" | "e2e-unrepairable",
    "review_ids": [<int>, ...]
  }
}
```

`kind`:
- `"ambiguous-review"` — one or more reviews classified ambiguous in this batch.
- `"design-adjustment"` — mid-cycle, the work surfaced a design-level conflict.
- `"rebase-conflict"` — an opt-in auto-rebase hit conflicts that couldn't be resolved and verified; the branch was restored to its pre-rebase SHA. `review_ids` may be empty.
- `"e2e-unrepairable"` — the E2E repair loop shipped with failures it could not fix: the user waived, or an unattended run or a spent iteration cap left the decision open for the user. `review_ids` is empty.
