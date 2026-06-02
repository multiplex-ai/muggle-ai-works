# Reply-echo skip

When `/muggle-do` posts a threaded reply to a review comment, GitHub surfaces that reply as a **new submitted review** under the same account. Left unchecked, the next watcher tick reads that review as fresh feedback and dispatches another cycle — which posts another reply, which becomes another review. The loop never converges.

## Rule

A submitted review is an **echo** when **every** comment in it carries the loop marker `<!-- muggle-do:bot -->` (see [`loop-signature.md`](loop-signature.md)). An echo is the loop's own reply wearing a review's clothing, never human intent.

On an echo review, the watcher must:

1. Advance `last_seen.reviewId` past the echo's id (so it is not seen again), and
2. **Skip it** — never dispatch `/muggle-do` for it.

## Detection

Classify by the marker, never by `author.login` — under a shared account the loop posts as the PR author, so the login cannot tell echo from human. Fetch the review's comments; if the set is non-empty and every comment body contains `<!-- muggle-do:bot -->`, it is an echo. A review with at least one marker-less comment is human feedback and must be processed normally.
