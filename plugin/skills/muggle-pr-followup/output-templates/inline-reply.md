# Per-comment inline reply

Posted via `gh api .../comments/<comment-id>/replies` per cycle, one per line comment.

```
Addressed in <short-sha>: <one-line summary of the change made for THIS comment>.
```

`<short-sha>` is the first 7 chars of the new SHA; the body must contain that substring so the resolve-reminder stage knows *which push* addressed the thread. Write the content only — the posting recipe signs it with `--mode loop` ([`../../_shared/vcs/post-signature.md`](../../_shared/vcs/post-signature.md)), appending the `<!-- muggle-do:bot -->` marker that identifies the comment as loop-authored.

## Top-level fallback (review-body-only)

When an actionable review has a non-empty body but zero line comments, GitHub has no `/replies` endpoint for the body. Post a top-level PR comment instead, at most once per such review:

```
Re: review #<review_id> — addressed in <short-sha>: <one-line summary>.
```

## Conversation-comment reply

A top-level PR comment (Conversation tab) has no reply endpoint. Answer it with its own top-level comment, exactly one per addressed conversation comment, quoting its first line and linking it so a reader can tell which comment it answers:

```
> <first line of the comment, trimmed>

Re: [comment](<comment html_url>) by @<author> — addressed in <short-sha>: <one-line summary>.
```

A question the round answered without a change drops `addressed in <short-sha>:` for the answer itself. Posted per [`../../_shared/vcs/github/top-level-comment.md`](../../_shared/vcs/github/top-level-comment.md) with `--mode loop`, so the watch reads it as the loop's own and never wakes on it.
