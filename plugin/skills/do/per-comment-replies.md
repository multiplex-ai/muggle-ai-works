# Per-Comment Inline Replies

A `/muggle-do` step invoked from [`address-reviews.md`](address-reviews.md) (Step 4f) after the push has succeeded. Posts one inline nested reply on each line comment from the actionable reviews, describing what was done for that comment and referencing the new SHA.

This is **not** a top-level "summary reply on the review." Each comment thread gets its own reply, in context — on `github` via the `/comments/{id}/replies` endpoint, on `gitlab` via a threaded note on the discussion.

## Inputs

- `actionable_reviews` — the list of reviews classified actionable in `address-reviews.md` Step 2. On `gitlab`, these are the actionable **discussions** (no review envelope) — read each as a thread of notes.
- `new_sha` — the SHA `open-prs/update.md` just pushed.
- The PR's owner, repo, number. On `gitlab`, the project ref and MR iid.

Resolve the provider once per [`../_shared/vcs/detect-vcs.md`](../_shared/vcs/detect-vcs.md).

## Procedure

### Step 1 — Build the comment-to-change map

For each comment in each actionable review, the cycle's `build.md` produced (or should have produced) a one-line note describing what was changed for that specific comment. Two sources, in order:

1. If `build.md` returned a `comment_changes` map keyed by comment id → short description, use it directly.
2. If not (legacy `build.md` that doesn't return that shape yet), infer from the diff + the comment's body: which file/line did the comment refer to, and what changed at or near it. The inferred description is best-effort; better to be brief than wrong.

If a comment has no associated change in either source (e.g. the comment was a question, not a change request), use the comment's body to compose a one-sentence answer.

### Step 2 — Post one reply per comment

For each comment id with a description, post the reply with the resolved provider:

- **`github`** — nested reply on the line comment, one per actionable comment, per [`../_shared/vcs/github/reply-line-comment.md`](../_shared/vcs/github/reply-line-comment.md).

- **`gitlab`** — one threaded note per actionable discussion per [`../_shared/vcs/gitlab/reply-discussion.md`](../_shared/vcs/gitlab/reply-discussion.md) (the discussion id stands in for the comment id). Reply only: **never resolve the discussion.** GitLab classifies by the same `<!-- muggle-do:bot -->` marker GitHub does ([`../_shared/vcs/gitlab/unresolved-discussions.md`](../_shared/vcs/gitlab/unresolved-discussions.md)), so the marked note alone folds it out of the next tick's actionable set — the resolve adds nothing the reply has not already done, and MRs that gate merging on "all threads resolved" would have the loop clearing its own merge gate.

Reply body uses the template in [`../muggle-pr-followup/output-templates/inline-reply.md`](../muggle-pr-followup/output-templates/inline-reply.md):

```
Addressed in <short-sha>: <one-line summary of the change made for THIS comment>.
```

`<short-sha>` is the first 7 chars of `new_sha`; the body must contain that substring so the resolve-reminder stage knows which push addressed the thread. Write the content only — the posting recipe signs it with `--mode loop`, which appends the `<!-- muggle-do:bot -->` marker that identifies the reply as loop-authored (see [`../_shared/pr-followup-helpers/loop-signature.md`](../_shared/pr-followup-helpers/loop-signature.md)).

### Step 3 — Handle review-body-only comments (GitHub only)

GitLab has no review envelope — every note belongs to a discussion handled in Step 2 — so this step is GitHub-only.


If an actionable review has a non-empty `body` and **zero** line comments, GitHub has no `/replies` endpoint for the review body itself (the API has been inconsistent on this and the only reliable path is a top-level PR comment that references the review). Use the *top-level reference* form:

```
Re: review #<review_id> — addressed in <short-sha>: <one-line summary>.
```

Posted per [`../_shared/vcs/github/top-level-comment.md`](../_shared/vcs/github/top-level-comment.md). Fires at most once per actionable review-with-no-line-comments. Does not fire if the review has line comments — Step 2 covers those.

## Failure modes

- `gh api` returns an error for an individual reply → log to `followup.log`, continue with the remaining comments. Do not abort the whole step over one failure; the push has already happened and other replies still need posting.
- All replies fail → surface the most-recent `gh` error to the user, but do not abort the overall `/muggle-do` invocation. The resolve-reminder stage still runs; the watcher still respawns. The next cycle on this PR will produce more replies and the missing ones can be picked up by the human reviewer.

## Enforcement

A Stop-hook guardrail (`guardrail-comment-reply-gate.sh`) holds the turn open when the round pushed its change and a thread it pulled in still carries no loop-marked reply. It settles from signals this cycle already produces — the unresolved-thread fetch Step 1 runs and the reply calls Step 2 makes — so running this step is what clears it; nothing extra is owed.

A thread the round deferred to the user instead of answering (the ambiguous escalation in [`address-reviews.md`](address-reviews.md) Step 3) is cleared with `echo "MUGGLE_REPLY_SKIP: <comment-id> <reason>"`, one per deferred id. Naming no id degrades to a session-wide skip.

## Invariants

- One reply per line comment (`gitlab`: per discussion). No per-review summary reply anywhere.
- The loop never resolves a review thread, on either provider. A `PreToolUse` guardrail denies both calls.
- Every reply body contains the new SHA's 7-char prefix (which push addressed it) and ends with the loop signature block — the `<!-- muggle-do:bot -->` marker, not the author login, is what identifies loop-authored comments.
