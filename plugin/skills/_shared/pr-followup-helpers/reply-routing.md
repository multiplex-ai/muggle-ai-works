# Reply routing

GitHub's PR APIs are not uniform across comment types. Route by parent type.

## Line-level review comment (most common)

A comment attached to a specific file:line that belongs to a review thread.

```bash
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/<owner>/<repo>/pulls/<number>/comments/<comment_id>/replies \
  -f body="Done in $(git rev-parse --short HEAD) — renamed \`fooBar\` to \`foo_bar\`."
```

The reply lands in the same review thread with `in_reply_to_id = <comment_id>`.

## Review body (CHANGES_REQUESTED with no inline comments)

A reviewer left a summary review with `state: CHANGES_REQUESTED` and a body, but **no** inline comments. GitHub has no "reply to review body" endpoint — post a top-level PR comment that references the review:

```bash
gh pr comment <number> --repo <owner>/<repo> --body "Re: review #<review_id> — done in $(git rev-parse --short HEAD)."
```

## Failing CI check

No reply. The fix commit IS the response. Include the failing check name in the commit subject:

```
fix(ci): typecheck — narrow type of foo
fix(ci): lint — remove unused import
```

## Never

- Never post a top-level comment in reply to a line-level comment. It loses thread context.
- Never `gh pr review --comment` for replies — that endpoint is for *new* reviews.
- Never reply twice to the same comment. The cursor in `last_seen.json` is the only re-entry guard; advance it after every reply.
