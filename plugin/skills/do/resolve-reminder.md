# Resolve-Reminder Stage

A `/muggle-do` stage that runs in **address-reviews mode only**, after per-comment inline replies have been posted. Scans every unresolved comment thread on the PR, classifies them, and posts ONE top-level PR comment listing the threads the loop addressed in this push.

Runs zero or one times per `/muggle-do` invocation:

- Runs when at least one actionable review was processed (i.e. the cycle actually pushed).
- Does not run when the entire input batch was ambiguous (no push, nothing to remind about).
- Does not run in the forward pipeline (a fresh PR has no review threads to remind about).

## Turn preamble (inline within `/muggle-do` cycle)

This stage does not print a turn preamble — it runs inside `/muggle-do`'s address-reviews cycle, immediately after per-comment replies and before respawning the watcher.

## Inputs

- The current PR (URL, owner, repo, number) from the session's `prs.json`.
- `last_seen.pushed_shas[]` from `last_seen.json` — the list of every SHA `/muggle-do` has pushed for this PR.
- The loop user's GitHub login (cached in `state.md` under `Loop user:` — re-resolve via the "Identifying the loop user" recipe if missing).

## Procedure

### Step 1 — Fetch unresolved comment threads

Use the "Unresolved comment threads on a PR" recipe from [`../_shared/github-cli-recipes.md`](../_shared/github-cli-recipes.md). Filter client-side to `isResolved == false`. Each thread carries its line comments with `author.login`, `body`, and `databaseId`.

If the API call fails, log the error to `followup.log` and skip the stage. Do not surface a user-facing error — the resolve reminder is a nice-to-have, not load-bearing. The reply summaries on the threads themselves still happen.

### Step 2 — Classify each thread

For each unresolved thread, walk its comments in chronological order. Classify by the **first match** that applies:

- **Addressed by the loop** — at least one comment authored by the loop user **and** that comment's body cites a SHA prefix in `last_seen.pushed_shas[]`. Bodies use the form *"Addressed in `<short-sha>`: ..."* per [`../muggle-pr-followup/output-templates.md`](../muggle-pr-followup/output-templates.md#cycle-summary-inline-reply-per-comment), so a substring match on any `pushed_shas[i][:7]` works.
- **Addressed by a human** — at least one comment authored by a non-loop-user identity created after the original comment's timestamp, and no addressed-by-loop signal.
- **Not addressed** — neither of the above.

The classification considers only the unresolved threads' comments. Do not cross-reference timeline events from outside the threads.

### Step 3 — Build the resolve-reminder list

Collect the thread `databaseId` of every thread classified as **addressed by the loop in this push** (i.e. citing a SHA in `pushed_shas[]` where that SHA was added by the current invocation; older SHAs were already covered by prior cycles' reminders).

Note: the watcher does not maintain a "addressed-this-cycle" set; this stage derives it by comparing thread comments to the most-recent appended SHA. The simplest deterministic rule: include a thread iff at least one of its bot replies cites the **most recent** `pushed_shas[-1]`. Earlier SHAs were already addressed in past reminders.

### Step 4 — Post the top-level reminder comment

If the resolve-reminder list is non-empty, post **one** top-level PR comment using the template from [`../muggle-pr-followup/output-templates.md`](../muggle-pr-followup/output-templates.md#resolve-reminder-top-level-pr-comment) via the "Top-level PR comment" recipe.

If the list is empty (the push didn't end up addressing any threads — e.g. the actionable work was on lines that had no comment threads), post **nothing**. Still emit telemetry so the stage's run is observable.

### Step 5 — Emit telemetry

Emit one `resolve-reminder` event per [`../_shared/telemetry-events.md`](../_shared/telemetry-events.md#resolve-reminder--one-per-resolve-reminder-stage-run). Include:

- `addressed_by_loop` — count of threads added to the reminder list in Step 3.
- `addressed_by_human` — count from Step 2's other category.
- `not_addressed` — count from Step 2's "not addressed" category.
- `comment_posted` — true iff Step 4 actually posted a comment.

## Failure modes

This stage is best-effort. Any failure is logged to `followup.log` and silently skipped — the reviewer still gets the per-comment inline replies (the canonical signal that work was done), and the cycle continues to respawn the watcher.

The one exception: do not silently swallow a `gh pr comment` failure if Step 4 ran. The comment is a user-visible artifact; if it fails, surface the underlying `gh` error to the user so they know the reminder didn't post.

## Self-check

- [ ] If actionables ran in this `/muggle-do` invocation, Step 1 was attempted.
- [ ] Exactly one `resolve-reminder` telemetry event emitted, regardless of whether a comment was posted.
- [ ] When a comment is posted, its body matches the template (one short SHA + bulleted thread ids).

## What this stage does NOT do

- Resolve threads on the user's behalf. GitHub does not expose a "mark thread resolved" mutation via the gh CLI in a way that respects the user's intent — we only suggest.
- Re-post resolve reminders for past pushes. Each cycle's reminder covers only that cycle's push.
- Run during the forward pipeline. The forward pipeline's `open-prs.md` creates a fresh PR with no existing threads; there is nothing to remind about.
- Inspect telemetry counts to decide whether to post. The only gate is "is the reminder list non-empty in Step 3?".
