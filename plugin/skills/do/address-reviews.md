# Address-Reviews Orchestrator

The entry procedure for `/muggle-do`'s **address-reviews** mode — invoked by the watcher loop ([`../muggle-pr-followup/contract.md`](../muggle-pr-followup/contract.md)) when new submitted reviews land on a PR. Orchestrates the cycle: read reviews → classify → execute work on actionables → escalate ambiguous → push and refresh PR → reply per comment → resolve-reminder → respawn watcher.

## Turn preamble

```
**/muggle-do address-reviews** — handling <count> review(s) on <owner>/<repo>#<n>.
```

## Input

`$ARGUMENTS` carries:
- PR URL: `<owner>/<repo>#<n>` derivable from the URL.
- Session slug: `<slug>`.
- Owning review ids: one or more integers (the reviews whose actionable threads or body-only feedback the watcher flagged).

Exact phrasing comes from the watcher's dispatch (see [`../muggle-pr-followup/contract.md`](../muggle-pr-followup/contract.md)). Parse all three out of the directive text.

## Inputs from disk

Read from `~/.muggle-ai/muggle-do/sessions/<slug>/`:

- `prs.json` — to locate the PR's local checkout path (the `repo` field maps to a configured local repo) and capture `head_sha_before`.
- `last_seen.json` — for `pushed_shas[]` (used by the resolve-reminder stage) and to update `lastBodyReviewId`.
- `state.md` — for the cached `loop_user` login (used by resolve-reminder thread classification).

## Procedure

### Step 0 — Track the default branch

Before assembling work, rebase onto the latest default branch so the cycle addresses reviews against current master, not a stale base. Run [`../_shared/rebase-before-e2e.md`](../_shared/rebase-before-e2e.md) — gated by [`autoRebase`](../muggle-preferences/preference-gates/autoRebase.md), fires only when `behind > 0`. Conflict handling follows [`autoResolveConflicts`](../muggle-preferences/preference-gates/autoResolveConflicts.md): the default `never` aborts and escalates (`kind: "rebase-conflict"`); `always` resolves behind the verify-or-rollback gate. If the rebase escalates, stop the cycle — do not push, do not address reviews — but **skip to Step 6 to respawn the watcher**. Escalating the rebase does not end the PR; the poller must keep running (it will remind on the `conflict_escalated` block), so skipping respawn here is exactly the silent-stop bug [`respawn-watcher.md`](respawn-watcher.md) exists to prevent.

### Step 1 — Assemble the work set

Resolve the provider per [`../_shared/vcs/detect-vcs.md`](../_shared/vcs/detect-vcs.md), then assemble.

**`github`** — two sources, combined into one batch (dedupe by comment id):

**(a) The dispatched reviews.** For each review id in the input:

- Fetch reviews per [`../_shared/vcs/github/submitted-reviews.md`](../_shared/vcs/github/submitted-reviews.md) (no watermark; filter to the specific id).
- Fetch its line comments per [`../_shared/vcs/github/line-comments-for-review.md`](../_shared/vcs/github/line-comments-for-review.md).

**(b) Unaddressed comments on every unresolved thread.** Fetch unresolved threads per [`../_shared/vcs/github/unresolved-threads.md`](../_shared/vcs/github/unresolved-threads.md). For each thread classified **unaddressed human comment** — newest comment lacks the loop marker `<!-- muggle-do:bot -->` ([`loop-signature.md`](../_shared/pr-followup-helpers/loop-signature.md)) and post-dates the loop's last marked reply — add it to the batch — unresolved thread state, not any review-id watermark, is the authority here. This is how a human thread follow-up (a marker-less reply) gets addressed. **Exclude** comments whose review id is in `last_seen.escalated_review_ids` — paused awaiting the user, not re-work.

Group (a) and (b) into one combined batch.

**`gitlab`** — single source (no review-id watermark; discussion state is the sole authority). Fetch unresolved discussions per [`../_shared/vcs/gitlab/unresolved-discussions.md`](../_shared/vcs/gitlab/unresolved-discussions.md) (drop to [`../_shared/vcs/gitlab/mr-discussions.md`](../_shared/vcs/gitlab/mr-discussions.md) for raw notes where classification needs them). The input ids are discussion ids; the batch is every discussion classified **unaddressed human comment** — newest note lacks the marker and post-dates the loop's last marked note. **Exclude** discussions whose id is in `last_seen.escalated_review_ids`. A discussion is the unit of work in place of GitHub's review + line-comment pair.

### Step 2 — Classify each review

Apply the classify rule in [`../_shared/pr-followup-helpers/classify.md`](../_shared/pr-followup-helpers/classify.md). Two outcomes per review:

- **Actionable** — at least one concrete change request, or an answerable question with a target.
- **Ambiguous** — no actionable signal.

Build two sets: `actionable_review_ids` and `ambiguous_review_ids`. Their union is the input list.

### Step 3 — Handle ambiguous (if any)

For each id in `ambiguous_review_ids`:

1. Append it to `last_seen.escalated_review_ids` so the watcher won't re-dispatch it.

Emit **one** terminal escalation message (not one per ambiguous review) per [`../muggle-pr-followup/output-templates/escalation.md`](../muggle-pr-followup/output-templates/escalation.md) (ambiguous template). The message lists every ambiguous review and its comments inline. Emit an event with `kind: "ambiguous-review"` per [`../_shared/telemetry-events/muggle-do-escalation.md`](../_shared/telemetry-events/muggle-do-escalation.md).

The user clarifies on GitHub by submitting a new review. The next watcher tick picks it up.

### Step 4 — Handle actionables (if any)

If `actionable_review_ids` is empty, skip the rest of Step 4 and Step 5; proceed to Step 5.5 (resolve-reminder) then Step 6. Otherwise:

Before any edits, ensure the PR's branch workspace is the working directory. If `state.md` carries a `worktreePath` (forward-mode session), use it. Otherwise materialize the PR branch per [`../_shared/pr-branch-worktree.md`](../_shared/pr-branch-worktree.md) — the single owner of checking out a PR branch in isolation — so a bootstrap or auto-track watcher never edits the user's live checkout. If the resolved tree is dirty with unrelated work, escalate per Step 7 rather than editing it.

#### 4a. Flatten the work

The actionable reviews together carry a flat list of change items, one per line comment plus any directive in the review body. Each item is design, code logic, or test in nature; the cycle does **not** treat each item as a separate cycle iteration — it plans them together and runs the work **once** for the whole batch.

#### 4b. Apply design + code-logic changes

Invoke [`build.md`](build.md) with the review-derived requirements: for each comment, what to change and where. `build.md` makes the edits in the working tree but does not commit.

If `build.md` reports that the requested work requires rethinking the design (e.g. the requested change conflicts with a load-bearing invariant), exit early per Step 7 (design-adjustment escalation).

#### 4c. Create or update unit tests

Invoke [`unit-tests.md`](unit-tests.md). Cover the surface that just changed; respect existing test conventions.

#### 4d. Run ONE E2E acceptance pass

Invoke [`e2e-acceptance.md`](e2e-acceptance.md). One pass covering all related test cases for this PR, not one per comment. The stage reads the persisted validation context (seeded by pre-flight or by bootstrap Step 6.5); a poll-only session with no context (e.g. auto-track) is reported `SKIPPED`. The persisted `Validation` strategy is the standing decision — no per-tick `autoE2ETest` prompt. See [`e2e-acceptance.md`](e2e-acceptance.md) Step 0 and [`../_shared/resolve-e2e-validation-context.md`](../_shared/resolve-e2e-validation-context.md).

#### 4e. Create or update the PR

Invoke [`open-prs/update.md`](open-prs/update.md) (pass the PR URL + slug + existing PR number). It pushes, refreshes title/description on state change, posts a fresh walkthrough comment, and appends the new SHA to `last_seen.pushed_shas[]`. Capture the new `head_sha`.

#### 4f. Post per-comment inline replies

Invoke [`per-comment-replies.md`](per-comment-replies.md) with the actionable reviews (`gitlab`: discussions) and the new SHA. One reply per comment, in its own thread, describing what was done for it; on `gitlab` the same step also resolves each fully-addressed discussion.

(The resolve-reminder runs once per round in Step 5.5 below — not only after a push — so a round that pushed nothing still nudges addressed-but-unresolved threads.)

### Step 5 — Update session state

Apply each field write below as a whole-file rewrite (Read → change field → Write) per [`../_shared/session-state-writes.md`](../_shared/session-state-writes.md) — never the Edit tool.

- `last_seen.cycles_completed` += 1
- `last_seen.last_pushed_sha` = the new head SHA (update.md already wrote this; verify)
- `last_seen.lastBodyReviewId` = max(body-only input review ids ∪ last_seen.lastBodyReviewId) — line-comment threads need no watermark; they fall out of the actionable set once the per-comment reply carries the loop marker.

### Step 5.5 — Resolve-reminder (runs every round)

Invoke [`resolve-reminder.md`](resolve-reminder.md) once, regardless of whether this round pushed. It scans unresolved threads, finds those whose newest comment is loop-marked (addressed, awaiting resolve), and posts one top-level PR comment nudging the reviewer to resolve them — or stays silent if there are none. Threads with a newer human comment were already pulled into this round's work set in Step 1(b).

### Step 6 — Respawn the watcher

Respawn per [`respawn-watcher.md`](respawn-watcher.md): refresh PR state, finalize (write `result.md`, no respawn) if the PR is now merged or closed, otherwise restart the single live watcher as the turn's last action. **Every** exit path in this procedure lands here — the actionable-and-pushed happy path, the ambiguous-only branch (Step 3), the design-adjustment escalation, and the Step 0 rebase-escalation — so an open PR is never left un-watched.

### Step 7 — Telemetry

Emit one event per [`../_shared/telemetry-events/muggle-do-cycle.md`](../_shared/telemetry-events/muggle-do-cycle.md). `outcome` is one of:

- `"pushed"` — actionables ran and at least one push succeeded.
- `"escalated"` — only ambiguous; no push.
- `"mixed"` — both branches ran.
- `"no-op"` — every input id was already in `escalated_review_ids` (the watcher shouldn't have dispatched, but defensive coverage).

Emit additional events as Steps fired them (escalation event in Step 3; resolve-reminder event in Step 4g).

## Design-adjustment escalation (Step 4b early exit)

When `build.md` returns `failed: design-adjustment`:

1. Append the affected review ids to `last_seen.escalated_review_ids`.
2. Emit one terminal message per [`../muggle-pr-followup/output-templates/escalation.md`](../muggle-pr-followup/output-templates/escalation.md) (design-adjustment template).
3. Emit the `escalation` telemetry event with `kind: "design-adjustment"`.
4. Skip to Step 6 (respawn watcher). The watcher continues polling — the user can override the design conflict by submitting a new review.

Do **not** push, do **not** post replies, do **not** run resolve-reminder. The cycle ended on a design conflict; the work was not applied.

## Invariants

- One `/muggle-do` invocation = at most one push and one resolve-reminder, regardless of how many reviews are in the batch.
- Every input review id ends up either handled (its thread answered with a loop-marked reply, or — for a body-only review — folded into `lastBodyReviewId`) or in `escalated_review_ids` (skipped) — never both, never neither.
- The watcher is respawned exactly when the PR is still open at the end of the cycle.
