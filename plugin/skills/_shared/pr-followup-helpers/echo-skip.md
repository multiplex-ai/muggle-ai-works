# Echo protection (intrinsic under thread-state)

When `/muggle-do` posts a threaded reply to a review comment, GitHub surfaces that reply as a **new submitted review** under the same account, and the reply becomes the newest comment in its thread. The watcher must never read that as fresh feedback, or it replies to itself forever.

Under the thread-state dispatch trigger this is **intrinsic** — there is no "advance past the echo" step to get wrong:

- **Line-comment threads.** A thread is actionable only when its newest comment lacks the loop marker `<!-- muggle-do:bot -->` (see [`loop-signature.md`](loop-signature.md)). After the loop replies, the newest comment is the loop's own and carries the marker, so the thread drops out of the actionable set on its own.
- **Body-only reviews.** A loop reply always carries a line comment, so it is never body-only; the body-only check (no line comments, `id > lastBodyReviewId` — see [`../github-cli-recipes/submitted-reviews.md`](../github-cli-recipes/submitted-reviews.md)) excludes echoes structurally.

Classify by the marker, never by `author.login` — under a shared account the loop posts as the PR author, so the login cannot tell echo from human.
