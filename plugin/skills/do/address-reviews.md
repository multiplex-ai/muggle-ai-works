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
- List of review ids: one or more integers.

Exact phrasing comes from the watcher's dispatch (see [`../muggle-pr-followup/contract.md`](../muggle-pr-followup/contract.md#step-5-if-one-or-more-new-reviews-dispatch)). Parse all three out of the directive text.

## Inputs from disk

Read from `.muggle-do/sessions/<slug>/`:

- `prs.json` — to locate the PR's local checkout path (the `repo` field maps to a configured local repo) and capture `head_sha_before`.
- `last_seen.json` — for `pushed_shas[]` (used by the resolve-reminder stage) and to update the cursor.
- `state.md` — for the cached `loop_user` login (used by resolve-reminder thread classification).

## Procedure

### Step 1 — Read every listed review off GitHub

For each review id in the input:

- Use the "Submitted reviews past a cursor" recipe (cursor 0; filter to the specific id).
- Fetch its line comments via the "Line comments for a specific review" recipe.

Group into one combined batch.

### Step 2 — Classify each review

Apply the classify rule in [`../_shared/pr-followup-helpers.md`](../_shared/pr-followup-helpers.md). Two outcomes per review:

- **Actionable** — at least one concrete change request, or an answerable question with a target.
- **Ambiguous** — no actionable signal.

Build two sets: `actionable_review_ids` and `ambiguous_review_ids`. Their union is the input list.

### Step 3 — Handle ambiguous (if any)

For each id in `ambiguous_review_ids`:

1. Append it to `last_seen.escalated_review_ids` so the watcher won't re-dispatch it.

Emit **one** terminal escalation message (not one per ambiguous review) using the *Ambiguous escalation* template from [`../muggle-pr-followup/output-templates.md`](../muggle-pr-followup/output-templates.md#ambiguous-escalation). The message lists every ambiguous review and its comments inline. Emit the `escalation` telemetry event with `kind: "ambiguous-review"` per [`../_shared/telemetry-events.md`](../_shared/telemetry-events.md#escalation--one-per-terminal-escalation-message).

The user clarifies on GitHub by submitting a new review. The next watcher tick picks it up.

### Step 4 — Handle actionables (if any)

If `actionable_review_ids` is empty, skip Steps 4 and 5; proceed to Step 6 (cursor + respawn). Otherwise:

#### 4a. Flatten the work

The actionable reviews together carry a flat list of change items, one per line comment plus any directive in the review body. Each item is design, code logic, or test in nature; the cycle does **not** treat each item as a separate cycle iteration — it plans them together and runs the work **once** for the whole batch.

#### 4b. Apply design + code-logic changes

Invoke [`build.md`](build.md) with the review-derived requirements: for each comment, what to change and where. `build.md` makes the edits in the working tree but does not commit.

If `build.md` reports that the requested work requires rethinking the design (e.g. the requested change conflicts with a load-bearing invariant), exit early per Step 7 (design-adjustment escalation).

#### 4c. Create or update unit tests

Invoke [`unit-tests.md`](unit-tests.md). Cover the surface that just changed; respect existing test conventions.

#### 4d. Run ONE E2E acceptance pass

Invoke [`e2e-acceptance.md`](e2e-acceptance.md). One pass covering all related test cases for this PR, not one pass per comment. Use the `autoE2ETest` gate per its usual contract.

#### 4e. Create or update the PR

Invoke [`open-prs.md`](open-prs.md) in **address-reviews mode** (pass the PR URL + slug + existing PR number). open-prs.md pushes, refreshes title/description if state changed, posts a fresh walkthrough comment, and appends the new SHA to `last_seen.pushed_shas[]`. Capture the new `head_sha`.

#### 4f. Post per-comment inline replies

Invoke [`per-comment-replies.md`](per-comment-replies.md) with the actionable reviews and the new SHA. One reply per comment, in its own thread, describing what was done for it.

#### 4g. Run the resolve-reminder stage

Invoke [`resolve-reminder.md`](resolve-reminder.md). Scans unresolved threads, classifies, and posts a top-level PR comment listing addressed-by-loop thread ids.

### Step 5 — Update session state

- `last_seen.cycles_completed` += 1
- `last_seen.last_pushed_sha` = the new head SHA (open-prs.md already wrote this; verify)
- `last_seen.reviewId` = max(input review ids ∪ last_seen.reviewId)

### Step 6 — Respawn the watcher

Refresh PR state via the "PR metadata snapshot" recipe. If the PR is now merged or closed:

1. Write `result.md` per [`../muggle-pr-followup/state-schemas.md`](../muggle-pr-followup/state-schemas.md#resultmd).
2. Do **not** respawn the watcher.

Otherwise, dispatch the next watcher as the last action of this turn:

```
/loop 1m /muggle:muggle-pr-followup <slug> <n>
```

### Step 7 — Telemetry

Emit one `cycle` event per [`../_shared/telemetry-events.md`](../_shared/telemetry-events.md#cycle--one-per-address-reviews-invocation). `outcome` is one of:

- `"pushed"` — actionables ran and at least one push succeeded.
- `"escalated"` — only ambiguous; no push.
- `"mixed"` — both branches ran.
- `"no-op"` — every input id was already in `escalated_review_ids` (the watcher shouldn't have dispatched, but defensive coverage).

Emit additional events as Steps fired them (escalation event in Step 3; resolve-reminder event in Step 4g).

## Design-adjustment escalation (Step 4b early exit)

When `build.md` returns `failed: design-adjustment`:

1. Append the affected review ids to `last_seen.escalated_review_ids`.
2. Emit one terminal message using the *Design-adjustment escalation* template from [`../muggle-pr-followup/output-templates.md`](../muggle-pr-followup/output-templates.md#design-adjustment-escalation).
3. Emit the `escalation` telemetry event with `kind: "design-adjustment"`.
4. Skip to Step 6 (respawn watcher). The watcher continues polling — the user can override the design conflict by submitting a new review.

Do **not** push, do **not** post replies, do **not** run resolve-reminder. The cycle ended on a design conflict; the work was not applied.

## Self-check before ending the turn

- [ ] Every input review id was either processed (actionable) or escalated (ambiguous).
- [ ] When actionables ran: one push, N inline replies, one resolve-reminder run (which may or may not have posted a comment).
- [ ] When ambiguous existed: one terminal escalation message printed; ids in `escalated_review_ids`.
- [ ] `last_seen.json` updated: cursor advanced, `pushed_shas[]` extended, counters incremented.
- [ ] One `cycle` telemetry event emitted (plus any escalation/resolve-reminder events).
- [ ] Watcher respawned **only if** PR is still open and not merged/closed.
- [ ] No `cycle.json` or `requirements.md` was read or written in the session slot.

## What this stage does NOT do

- Run pre-flight (Stage 1) or requirements gathering (Stage 2). The reviews are the requirements.
- Create a PR. The PR exists — `open-prs.md` runs in address-reviews mode.
- Iterate the actionable reviews one-at-a-time. The whole batch produces one cycle, one push.
