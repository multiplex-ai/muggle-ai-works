# Watcher Per-Tick Contract

The procedure for the **tick mode** of `muggle-pr-followup` — one polling iteration scoped to one PR. The watcher is a dumb pipe: it polls for actionable review threads, CI checks, and the branch's standing against its base, dispatches `/muggle-do` if there's unaddressed review feedback, fixable red CI, or a branch that's behind or conflicting with its base, and exits. It does not classify, fix, resolve, rebase, amend requirements, post replies, run cycles, or escalate.

Routing into this mode is documented in [`SKILL.md`](SKILL.md#routing). The architectural rationale lives in the brain docs `architecture/2026-05-08-muggle-do-pr-comment-loop-design.md` (the overall loop) and `architecture/2026-06-06-pr-followup-thread-state-baseline-design.md` (the thread-state dispatch trigger).

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


### Step 3 — Compute the actionable set from live thread state

The watcher's dispatch trigger is **derived from current GitHub state**, not a stored review-id cursor — see the [thread-state baseline design](../../../../muggle-ai-brain/architecture/2026-06-06-pr-followup-thread-state-baseline-design.md). Two sources, unioned:

**(a) Actionable threads.** Fetch unresolved review threads per [`../_shared/github-cli-recipes/unresolved-threads.md`](../_shared/github-cli-recipes/unresolved-threads.md). A thread is **actionable** when `isResolved == false` **and** `isOutdated == false` **and** its newest comment lacks the loop marker `<!-- muggle-do:bot -->` — classify by the marker, never `author.login` (see [`../_shared/pr-followup-helpers/loop-signature.md`](../_shared/pr-followup-helpers/loop-signature.md)). The marker rule makes echo intrinsic: once the loop has replied, the thread's newest comment is the loop's own, so the thread is no longer actionable — no cursor to advance, no self-recursion (see [`../_shared/pr-followup-helpers/echo-skip.md`](../_shared/pr-followup-helpers/echo-skip.md)).

**(b) Actionable body-only reviews.** A body-only review — a submitted `CHANGES_REQUESTED`/`COMMENTED` review with no line comments — has no thread to derive state from, so it keeps a narrow watermark. Fetch submitted reviews per [`../_shared/github-cli-recipes/submitted-reviews.md`](../_shared/github-cli-recipes/submitted-reviews.md); a body-only review is actionable when `id > last_seen.lastBodyReviewId` **and** `id ∉ last_seen.escalated_review_ids`.

Collect the **owning review ids** for dispatch: for each actionable thread, the owning review of its newest comment (`pullRequestReview.databaseId` from the query); plus every actionable body-only review id. The dedup'd union is the dispatch list.

### Step 4 — If the actionable set is non-empty → dispatch (reviews preempt CI)

The watcher does **not** classify. Classification, batching, replying, escalation, and cycle execution all live in `/muggle-do`. The watcher hands over the owning review ids and exits — `/muggle-do`'s address-reviews re-derives the unresolved threads itself (its authority), so the watcher only needs to decide *that* there is work, not enumerate it exhaustively.

1. Reset `last_seen.idle_tick_count` to 0.
2. **Stop this watcher (single-thread).** Cancel its cron so no tick fires while the dev cycle runs: `CronList`, find the job whose command ends with `/muggle:muggle-pr-followup <slug> <n>` (exact two-arg match), `CronDelete` it. `/muggle-do` respawns the watcher when the cycle finishes — exactly one cron ever, and no tick overlaps a running cycle.
3. Dispatch `/muggle-do` with an *address-reviews* directive carrying:
   - PR URL (from `prs.json[0].url`)
   - Session slug (from the invocation arguments)
   - The owning review ids from Step 3, as a space-separated list

   Exact phrasing belongs to `/muggle-do`'s intent-routing. A reasonable shape is:
   ```
   /muggle-do address reviews <id1> <id2> ... on <pr-url> slug=<slug>
   ```
4. Append a dispatching line to `followup.log` per [`output-templates/watcher-log.md`](output-templates/watcher-log.md).
5. Emit a `tick` event with `actionable_threads: <count>`, `dispatched_review_ids: [<id>, ...]`.
6. Exit. **Reviews preempt CI** — when there is actionable feedback, this tick dispatches address-reviews and never polls CI. The watcher is now stopped; the dev cycle owns the PR and restarts the watcher when it finishes. (The watcher also self-unschedules in Step 2, terminal.)

### Step 5 — No actionable feedback → keep the branch rebased on its base

A merge-ready branch is **current with its base** — neither conflicting nor behind. Read `mergeable` / `mergeStateStatus` from the Step 1 metadata; the branch needs a rebase when either:

- `mergeable == CONFLICTING` or `mergeStateStatus == DIRTY` — conflicts with the base, **or**
- `mergeStateStatus == BEHIND` — out of date with the base, no conflict. An unrebased branch never becomes merge-ready on its own, and is merge-blocked wherever the base requires up-to-date branches.

If a rebase is due **and** `conflict_resolve_attempts[head_sha] < 2` **and** `head_sha` ∉ `conflict_escalated_shas` → dispatch and exit:

  1. Reset `last_seen.idle_tick_count` to 0.
  2. **Stop this watcher (single-thread):** cancel its cron exactly as in Step 4 — `/muggle-do`'s rebase respawns it when the cycle is done.
  3. Dispatch `/muggle-do` with a *rebase* directive (PR URL + slug; no review ids, no check names):
     ```
     /muggle-do rebase on <pr-url> slug=<slug>
     ```
     The executor rebases onto the base: a behind-only branch replays cleanly and force-pushes; a conflicting branch resolves behind the `autoResolveConflicts` gate. Both paths are `/muggle-do`'s — the watcher only decides *that* a rebase is due, never how.
  4. Append a dispatching line to `followup.log`; emit a `tick` event with `rebase_needed: true`, `dispatched_rebase: true`.
  5. Exit. The dev cycle owns the PR; its respawn restarts the watcher, whose next tick re-checks the branch against its base on the new head — the rebase is its own verify loop, bounded by the per-SHA attempt budget.

Branch current with its base (`CLEAN` / `BLOCKED` / `UNSTABLE` / `HAS_HOOKS`), `mergeable == UNKNOWN` (GitHub still computing — treat as current this tick), or budget spent (`conflict_resolve_attempts[head_sha] >= 2` or `head_sha` ∈ `conflict_escalated_shas`) → fall through to CI.

### Step 6 — No actionable feedback, branch current → poll CI for the head SHA

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

Any idle branch (Steps 4–6 that did not dispatch): increment `last_seen.idle_tick_count`, append an idle line to `followup.log` per [`output-templates/watcher-log.md`](output-templates/watcher-log.md), emit a `tick` event with `idle: true`, `actionable_threads: 0`, `dispatched_review_ids: []`, `rebase_needed: <bool>`, `dispatched_rebase: false`, `checks_red: <count or 0>`, `dispatched_ci_fix: false`. Exit. The next tick fires in 1 min via `/loop`.

## Output

No console output beyond the turn preamble and (if Step 5 fires) the `/muggle-do` dispatch. The watcher is invisible to the reviewer.
