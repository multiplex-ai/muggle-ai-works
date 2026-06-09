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
  "ci_checks_in": ["<check-name>", ...],
  "ci_checks_fixed": ["<check-name>", ...],
  "ci_checks_escalated": ["<check-name>", ...],
  "head_sha_before": "<sha-or-null>",
  "head_sha_after": "<sha-or-null>",
  "outcome": "pushed" | "escalated" | "mixed" | "no-op" | "self-loop-skip" | "ci-fixed" | "ci-escalated" | "rebased" | "rebase-escalated"
}
```

`outcome`:
- `"pushed"` — at least one actionable, no ambiguous, push succeeded.
- `"escalated"` — all reviews were ambiguous; no push.
- `"mixed"` — both branches happened in the same invocation.
- `"no-op"` — every input id was already in the escalated set; no work.
- `"self-loop-skip"` — review was a synthetic wrapper around the agent's own reply (every line comment is a reply carrying the loop marker `<!-- muggle-do:bot -->`). Cursor advanced silently; no work, no escalation.
- `"ci-fixed"` — a watcher-dispatched fix-ci cycle pushed a fix for one or more red checks.
- `"ci-escalated"` — fix-ci exhausted its 3 attempts for the SHA or the failing checks were out of scope; the SHA was added to `ci_escalated_shas`. No further auto-fix on it.
- `"rebased"` — a watcher-dispatched rebase cycle rebased the branch onto its base (behind-only or conflicts resolved), verified, and force-pushed.
- `"rebase-escalated"` — the rebase couldn't be completed (a conflict under `autoResolveConflicts=never`, verification failed, or the 2-attempt budget for the SHA was spent); the SHA was added to `conflict_escalated_shas`. No further auto-rebase on it.

For fix-ci cycles (`ci-fixed` / `ci-escalated`) the `review_ids_*` arrays are empty and the `ci_checks_*` arrays carry the data: `ci_checks_in` (red checks dispatched), `ci_checks_fixed` (made green and pushed), `ci_checks_escalated` (out-of-scope or unresolved). For rebase cycles (`rebased` / `rebase-escalated`) all the `review_ids_*` and `ci_checks_*` arrays are empty; the SHA fields carry the before/after of the rebase.
