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

- **`github`** — nested reply on the line comment:

  ```bash
  gh api --method POST \
    -H "Accept: application/vnd.github+json" \
    repos/<owner>/<repo>/pulls/<n>/comments/<comment-id>/replies \
    -f body="<reply-body>"
  ```

- **`gitlab`** — one threaded note per actionable discussion per [`../_shared/vcs/gitlab/reply-discussion.md`](../_shared/vcs/gitlab/reply-discussion.md) (the discussion id stands in for the comment id), then resolve each fully-addressed thread per [`../_shared/vcs/gitlab/resolve-discussion.md`](../_shared/vcs/gitlab/resolve-discussion.md). The loop-marked reply is the addressed signal; the resolve is GitLab's equivalent of a reviewer closing the thread, which the loop can do directly. Resolving folds the discussion out of the next tick's actionable set, so no separate resolve-reminder nudge is needed for it.

Reply body uses the template in [`../muggle-pr-followup/output-templates/inline-reply.md`](../muggle-pr-followup/output-templates/inline-reply.md):

```
Addressed in <short-sha>: <one-line summary of the change made for THIS comment>.

<!-- muggle-do:bot -->
🤖 _Automated reply from muggle-do._
```

`<short-sha>` is the first 7 chars of `new_sha`; the body must contain that substring so the resolve-reminder stage knows which push addressed the thread. The trailing signature block is mandatory — its `<!-- muggle-do:bot -->` marker is what identifies the reply as loop-authored (see [`../_shared/pr-followup-helpers/loop-signature.md`](../_shared/pr-followup-helpers/loop-signature.md)).

### Step 3 — Handle review-body-only comments (GitHub only)

GitLab has no review envelope — every note belongs to a discussion handled in Step 2 — so this step is GitHub-only.


If an actionable review has a non-empty `body` and **zero** line comments, GitHub has no `/replies` endpoint for the review body itself (the API has been inconsistent on this and the only reliable path is a top-level PR comment that references the review). Use the *top-level reference* form:

```
Re: review #<review_id> — addressed in <short-sha>: <one-line summary>.

<!-- muggle-do:bot -->
🤖 _Automated reply from muggle-do._
```

Posted per [`../_shared/vcs/github/top-level-comment.md`](../_shared/vcs/github/top-level-comment.md). Fires at most once per actionable review-with-no-line-comments. Does not fire if the review has line comments — Step 2 covers those.

## Failure modes

- `gh api` returns an error for an individual reply → log to `followup.log`, continue with the remaining comments. Do not abort the whole step over one failure; the push has already happened and other replies still need posting.
- All replies fail → surface the most-recent `gh` error to the user, but do not abort the overall `/muggle-do` invocation. The resolve-reminder stage still runs; the watcher still respawns. The next cycle on this PR will produce more replies and the missing ones can be picked up by the human reviewer.

## Invariants

- One reply per line comment (`gitlab`: per discussion). No per-review summary reply anywhere.
- Every reply body contains the new SHA's 7-char prefix (which push addressed it) and ends with the loop signature block — the `<!-- muggle-do:bot -->` marker, not the author login, is what identifies loop-authored comments.
