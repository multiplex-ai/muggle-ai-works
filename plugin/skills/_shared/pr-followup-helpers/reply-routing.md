# Reply routing

Reply endpoints are not uniform across comment types. Route by parent type, then run the resolved provider's recipe for that route — resolve the provider once per [`../vcs/detect-vcs.md`](../vcs/detect-vcs.md). The routing decision below is provider-agnostic; the commands live with their tool.

## Line-level review comment (most common)

A comment attached to a specific file:line that belongs to a review thread. Reply in the same thread, so the reply keeps its context:

- `github` — [`../vcs/github/reply-line-comment.md`](../vcs/github/reply-line-comment.md). The reply lands in the thread with `in_reply_to_id = <comment_id>`.
- `gitlab` — [`../vcs/gitlab/reply-discussion.md`](../vcs/gitlab/reply-discussion.md). The reply is a new note on the discussion.

## Review body with no inline comments

A reviewer left a summary review with a body but **no** inline comments. There is no thread to reply into, so answer with a top-level comment that names the review:

- `github` — [`../vcs/github/top-level-comment.md`](../vcs/github/top-level-comment.md). GitHub has no reply-to-review-body endpoint, which is why this route exists at all.
- `gitlab` — does not arise. GitLab has no review envelope; every note belongs to a discussion, so it routes as a line-level reply above.

## Failing CI check

No reply on either provider. The fix commit IS the response. Include the failing check name in the commit subject:

```
fix(ci): typecheck — narrow type of foo
fix(ci): lint — remove unused import
```

## Never

- Never post a top-level comment in reply to a line-level comment. It loses thread context.
- Never open a *new* review to carry a reply (`github`: `gh pr review --comment`) — those endpoints are for new reviews, not replies.
- Never reply twice to the same comment. The loop marker on each posted reply is the re-entry guard — a thread whose newest comment is loop-marked is no longer actionable, so the next round won't re-reply.
