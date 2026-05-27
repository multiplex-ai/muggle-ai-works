# Resolve-Reminder Stage

A `/muggle-do` stage that runs in **address-reviews mode only**, near the end of each review round. Scans every unresolved comment thread on the PR, classifies them by the loop signature, and posts ONE top-level PR comment listing the threads the loop has addressed that are still unresolved with no newer human reply.

Runs once per `/muggle-do` address-reviews invocation (one review round):

- Runs every round, whether or not this round pushed — it nudges **all** still-unresolved loop-addressed threads, not only ones touched by this push.
- Posts a comment only when at least one such thread exists; otherwise silent.
- Does not run in the forward pipeline (a fresh PR has no review threads to remind about).

## Turn preamble (inline within `/muggle-do` cycle)

This stage does not print a turn preamble — it runs inside `/muggle-do`'s address-reviews cycle, immediately after per-comment replies and before respawning the watcher.

## Inputs

- The current PR (URL, owner, repo, number) from the session's `prs.json`.
- `last_seen.pushed_shas[]` from `last_seen.json` — the list of every SHA `/muggle-do` has pushed for this PR.
- The loop user's GitHub login (cached in `state.md` under `Loop user:` — re-resolve per [`../_shared/github-cli-recipes/loop-user-identity.md`](../_shared/github-cli-recipes/loop-user-identity.md) if missing).

## Procedure

### Step 1 — Fetch unresolved comment threads

Per [`../_shared/github-cli-recipes/unresolved-threads.md`](../_shared/github-cli-recipes/unresolved-threads.md). Filter client-side to `isResolved == false`. Each thread carries its line comments with `author.login`, `body`, and `databaseId`.

If the API call fails, log the error to `followup.log` and skip the stage. Do not surface a user-facing error — the resolve reminder is a nice-to-have, not load-bearing. The reply summaries on the threads themselves still happen.

### Step 2 — Classify each thread

Per [`../_shared/github-cli-recipes/unresolved-threads.md`](../_shared/github-cli-recipes/unresolved-threads.md): walk each thread's comments in `createdAt` order and classify by the loop marker `<!-- muggle-do:bot -->` ([`../_shared/pr-followup-helpers/loop-signature.md`](../_shared/pr-followup-helpers/loop-signature.md)), not by `author.login`:

- **Addressed, awaiting resolve** — the **newest** comment carries the marker. The loop replied and nothing newer is waiting. These feed the reminder.
- **Unaddressed human comment** — the newest comment lacks the marker and post-dates the loop's last marked reply (or there is no loop reply yet). The address-reviews round handles these as work (Step 1 sweep), not the reminder.
- **Not addressed** — indeterminate.

Consider only the threads' own comments. Do not cross-reference timeline events from outside the threads.

### Step 3 — Build the resolve-reminder list

Collect the thread `databaseId` of every thread classified **addressed, awaiting resolve** in Step 2 — every still-unresolved thread whose newest comment is loop-marked, regardless of which push addressed it. A thread stays on the list across rounds until the reviewer resolves it or replies; a human reply moves it to **unaddressed human comment** (into the round's work set, Step 1), so it drops off the reminder automatically.

### Step 4 — Post the top-level reminder comment

If the resolve-reminder list is non-empty, post **one** top-level PR comment using the template in [`../muggle-pr-followup/output-templates/resolve-reminder.md`](../muggle-pr-followup/output-templates/resolve-reminder.md) per [`../_shared/github-cli-recipes/top-level-comment.md`](../_shared/github-cli-recipes/top-level-comment.md). The comment carries the loop signature, so a later round's scan won't read it back as a human comment.

If the list is empty, post **nothing**. Still emit telemetry so the stage's run is observable.

### Step 5 — Emit telemetry

Emit one event per [`../_shared/telemetry-events/muggle-do-resolve-reminder.md`](../_shared/telemetry-events/muggle-do-resolve-reminder.md). Include:

- `addressed_by_loop` — count of threads on the reminder list (Step 3; newest comment loop-marked).
- `addressed_by_human` — count of threads with an unaddressed human comment (newest comment unmarked; handled by the round's Step 1 sweep, not the reminder).
- `not_addressed` — count from Step 2's indeterminate category.
- `comment_posted` — true iff Step 4 actually posted a comment.

## Failure modes

This stage is best-effort. Any failure is logged to `followup.log` and silently skipped — the reviewer still gets the per-comment inline replies (the canonical signal that work was done), and the cycle continues to respawn the watcher.

The one exception: do not silently swallow a `gh pr comment` failure if Step 4 ran. The comment is a user-visible artifact; if it fails, surface the underlying `gh` error to the user so they know the reminder didn't post.

## Invariants

- Telemetry fires once per invocation, even when no comment is posted.
- The reminder covers **every** still-unresolved thread whose newest comment is loop-marked — not just the most recent push. A thread leaves the reminder only when the reviewer resolves it or replies (a reply routes it to the round's work set).
- This stage suggests; it does not resolve threads on the reviewer's behalf.
