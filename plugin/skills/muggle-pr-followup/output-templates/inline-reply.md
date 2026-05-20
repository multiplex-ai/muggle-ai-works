# Per-comment inline reply

Posted via `gh api .../comments/<comment-id>/replies` per cycle, one per line comment.

```
Addressed in <short-sha>: <one-line summary of the change made for THIS comment>.
```

`<short-sha>` is the first 7 chars of the new SHA. The body must contain that substring — the resolve-reminder stage greps for it to classify threads as addressed-by-loop.

## Top-level fallback (review-body-only)

When an actionable review has a non-empty body but zero line comments, GitHub has no `/replies` endpoint for the body. Post a top-level PR comment instead, at most once per such review:

```
Re: review #<review_id> — addressed in <short-sha>: <one-line summary>.
```
