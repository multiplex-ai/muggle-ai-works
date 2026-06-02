# Watcher Per-Tick Contract

The procedure for the **tick mode** of `muggle-pr-followup` — one polling iteration scoped to one PR. The watcher is a dumb pipe: it polls for new submitted reviews, CI checks, and merge-conflict state, dispatches `/muggle-do` if there's review feedback, fixable red CI, or an unmergeable branch, and exits. It does not classify, fix, resolve, amend requirements, post replies, run cycles, or escalate.

Routing into this mode is documented in [`SKILL.md`](SKILL.md#routing). The architectural rationale lives in the brain doc `architecture/2026-05-08-muggle-do-pr-comment-loop-design.md`.

## Turn preamble

```
**muggle-pr-followup tick** — polling <repo>#<pr-number>.
```

## Input

`$ARGUMENTS = <slug> <pr-number>` (or `<pr-number>` alone — slug inferred from on-disk state per [`SKILL.md`](SKILL.md#routing)).

## Inputs from disk

Read these from `~/.muggle-ai/muggle-do/sessions/<slug>/`:

- `prs.json` — see [`state-schemas.md`](state-schemas.md#prsjson). The watcher touches the single entry whose `number` matches the dispatched PR number.
- `last_seen.json` — see [`state-schemas.md`](state-schemas.md#last_seenjson). Keyed by `"<owner>/<repo>#<n>"`.

If either file is missing or the PR is not in `prs.json`, the tick is a no-op. Log an error line in `followup.log` and exit. The watcher must not be invoked in this state — if it happens, the slot is corrupt.

## Procedure

### Step 0 — Stale-fire guard

If `prs.json[0].state` on disk is already `merged` or `closed`, this slot was finalized by a prior tick and this is a stale (queued) fire — per-minute cron fires enqueued while the session was busy still drain after the cron is cancelled. Defensively cancel any lingering cron for this slug (`CronList` → the job whose command ends with `/muggle:muggle-pr-followup <slug> <n>` → `CronDelete`; no-op if none), append a `stale-tick` line to `followup.log`, and exit. Do not re-fetch or re-finalize.

### Step 1 — Refresh PR state

Per [`../_shared/github-cli-recipes/pr-metadata.md`](../_shared/github-cli-recipes/pr-metadata.md). Update `prs.json[0].head_sha` and `prs.json[0].state` from the response; keep `mergeable` / `mergeStateStatus` from the same call for Step 5.

### Step 2 — Termination check

If `state` is `MERGED` or `CLOSED`:

1. Finalize the slot per [`finalize.md`](finalize.md) — mark terminal, write `result.md`, log + telemetry, unschedule this watcher's cron.
2. Hand off the terminal wrap-up as the last action of the turn — for both `MERGED` and `CLOSED`:

   ```
   /muggle-do post-merge cleanup slug=<slug> state=<merged|closed>
   ```

   `/muggle-do` owns the worktree/branch knowledge: it runs teardown only on `merged` (honoring the `autoCleanup` gate — `closed` is unmerged, so the branch and any worktree stay intact), then suggests the next step. This is a runtime dispatch, not a doc dependency on `/muggle-do` — see the one-way rule in [`../CLAUDE.md`](../CLAUDE.md).
3. Exit. The watcher has unscheduled itself; no future ticks fire for this PR.


### Step 3 — Fetch new submitted reviews

Per [`../_shared/github-cli-recipes/submitted-reviews.md`](../_shared/github-cli-recipes/submitted-reviews.md). Exclude two kinds of review id:

- ids in `last_seen.escalated_review_ids` — already escalated; the watcher must not re-dispatch them.
- **echo reviews** per [`../_shared/pr-followup-helpers/echo-skip.md`](../_shared/pr-followup-helpers/echo-skip.md) — a review whose every comment carries the loop marker is the loop's own reply, surfaced by GitHub as a new review. Advance `last_seen.reviewId` past it and skip; never dispatch, or the watcher replies to itself forever.

### Step 4 — If one or more new reviews → dispatch (reviews preempt CI)

The watcher does **not** classify. Classification, batching, replying, escalation, and cycle execution all live in `/muggle-do`. The watcher's job is to hand over the list of new review ids and exit.

1. Reset `last_seen.idle_tick_count` to 0.
2. **Stop this watcher (single-thread).** Cancel its cron so no tick fires while the dev cycle runs: `CronList`, find the job whose command ends with `/muggle:muggle-pr-followup <slug> <n>` (exact two-arg match), `CronDelete` it. `/muggle-do` respawns the watcher when the cycle finishes — exactly one cron ever, and no tick overlaps a running cycle.
3. Dispatch `/muggle-do` with an *address-reviews* directive carrying:
   - PR URL (from `prs.json[0].url`)
   - Session slug (from the invocation arguments)
   - Every new review id from Step 3, as a space-separated list

   Exact phrasing belongs to `/muggle-do`'s intent-routing. A reasonable shape is:
   ```
   /muggle-do address reviews <id1> <id2> ... on <pr-url> slug=<slug>
   ```
4. Append a dispatching line to `followup.log` per [`output-templates/watcher-log.md`](output-templates/watcher-log.md).
5. Emit a `tick` event with `reviews_seen: <count>`, `dispatched_review_ids: [<id>, ...]`.
6. Exit. **Reviews preempt CI** — when reviews land, this tick dispatches address-reviews and never polls CI. The watcher is now stopped; the dev cycle owns the PR and restarts the watcher when it finishes. (The watcher also self-unschedules in Step 2, terminal.)

### Step 5 — No new reviews → check mergeability

Read `mergeable` / `mergeStateStatus` from the Step 1 metadata. If `mergeable == CONFLICTING` (or `mergeStateStatus == DIRTY`), **and** `conflict_resolve_attempts[head_sha] < 2`, **and** `head_sha` ∉ `conflict_escalated_shas` → dispatch and exit:

  1. Reset `last_seen.idle_tick_count` to 0.
  2. **Stop this watcher (single-thread):** cancel its cron exactly as in Step 4 — `/muggle-do`'s resolve-conflicts respawns it when the cycle is done.
  3. Dispatch `/muggle-do` with a *resolve-conflicts* directive (PR URL + slug; no review ids, no check names):
     ```
     /muggle-do resolve conflicts on <pr-url> slug=<slug>
     ```
  4. Append a dispatching line to `followup.log`; emit a `tick` event with `conflicting: true`, `dispatched_resolve_conflicts: true`.
  5. Exit. The dev cycle owns the PR; its respawn restarts the watcher, whose next tick re-checks mergeability on the new head — the rebase is its own verify loop, bounded by the per-SHA attempt budget.

`mergeable == MERGEABLE` / `UNKNOWN` (GitHub still computing — treat as not-conflicting this tick), or budget spent (`conflict_resolve_attempts[head_sha] >= 2` or `head_sha` ∈ `conflict_escalated_shas`) → fall through to CI.

### Step 6 — No new reviews, mergeable → poll CI for the head SHA

Fetch the check-run rollup for `prs.json[0].head_sha` per [`../_shared/github-cli-recipes/pr-checks.md`](../_shared/github-cli-recipes/pr-checks.md), then:

- **Any check still pending** (`bucket == "pending"`) → idle (wait for checks to settle).
- **All checks green / skipped, or no checks** → idle (green path).
- **One or more checks red** (`bucket == "fail"`), **and** `ci_fix_attempts[head_sha] < 3`, **and** `head_sha` ∉ `ci_escalated_shas` → dispatch and exit:
  1. Reset `last_seen.idle_tick_count` to 0.
  2. **Stop this watcher (single-thread):** cancel its cron exactly as in Step 4 — `/muggle-do`'s fix-ci respawns it when the cycle is done.
  3. Dispatch `/muggle-do` with a *fix-ci* directive carrying the PR URL, slug, and the red check names (no review ids):
     ```
     /muggle-do fix ci <check-1> <check-2> ... on <pr-url> slug=<slug>
     ```
  4. Append a dispatching line to `followup.log`; emit a `tick` event with `checks_red: <count>`, `dispatched_ci_fix: true`.
  5. Exit. The dev cycle owns the PR; its respawn restarts the watcher, whose next tick re-checks CI on the new head SHA — CI itself is the verify loop.
- **One or more red, but `ci_fix_attempts[head_sha] >= 3` or `head_sha` ∈ `ci_escalated_shas`** → idle. The fix budget is spent; `/muggle-do`'s fix-ci stage already recorded the escalation. The watcher does not re-dispatch.

### Step 7 — Idle

Any idle branch (Steps 4–6 that did not dispatch): increment `last_seen.idle_tick_count`, append an idle line to `followup.log` per [`output-templates/watcher-log.md`](output-templates/watcher-log.md), emit a `tick` event with `idle: true`, `reviews_seen: 0`, `dispatched_review_ids: []`, `conflicting: <bool>`, `dispatched_resolve_conflicts: false`, `checks_red: <count or 0>`, `dispatched_ci_fix: false`. Exit. The next tick fires in 1 min via `/loop`.

## Output

No console output beyond the turn preamble and (if Step 5 fires) the `/muggle-do` dispatch. The watcher is invisible to the reviewer.
