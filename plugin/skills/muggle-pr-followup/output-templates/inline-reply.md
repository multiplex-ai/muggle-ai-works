# Per-comment inline reply

Posted via `gh api .../comments/<comment-id>/replies` per cycle, one per line comment.

```
Addressed in <short-sha>: <one-line summary of the change made for THIS comment>.

<!-- muggle-do:bot -->
🤖 _Automated reply from muggle-do._
```

`<short-sha>` is the first 7 chars of the new SHA; the body must contain that substring so the resolve-reminder stage knows *which push* addressed the thread. The trailing signature block — defined in [`../../_shared/pr-followup-helpers/loop-signature.md`](../../_shared/pr-followup-helpers/loop-signature.md) — is mandatory; its `<!-- muggle-do:bot -->` marker is what identifies the comment as loop-authored.

## Top-level fallback (review-body-only)

When an actionable review has a non-empty body but zero line comments, GitHub has no `/replies` endpoint for the body. Post a top-level PR comment instead, at most once per such review:

```
Re: review #<review_id> — addressed in <short-sha>: <one-line summary>.

<!-- muggle-do:bot -->
🤖 _Automated reply from muggle-do._
```
