# Watcher Per-Tick Contract

The procedure for the **tick mode** of `muggle-pr-followup` — one polling iteration scoped to one PR. The watcher is a dumb pipe: it polls for new submitted reviews and CI checks, dispatches `/muggle-do` if there's review feedback or fixable red CI, and exits. It does not classify, fix, amend requirements, post replies, run cycles, or escalate.

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

### Step 1 — Refresh PR state

Per [`../_shared/github-cli-recipes/pr-metadata.md`](../_shared/github-cli-recipes/pr-metadata.md). Update `prs.json[0].head_sha` and `prs.json[0].state` from the response.

### Step 2 — Termination check

If `state` is `MERGED` or `CLOSED`:

1. Finalize the slot per [`finalize.md`](finalize.md) — mark terminal, write `result.md`, log + telemetry, unschedule this watcher's cron.
2. **If `MERGED`**, hand off post-merge cleanup as the last action of the turn (skip on `CLOSED` — unmerged, leave the branch and any worktree intact):

   ```
   /muggle-do post-merge cleanup slug=<slug>
   ```

   `/muggle-do` owns the worktree/branch knowledge and honors the `autoCleanup` gate. This is a runtime dispatch, not a doc dependency on `/muggle-do` — see the one-way rule in [`../CLAUDE.md`](../CLAUDE.md).
3. Exit. The watcher has unscheduled itself; no future ticks fire for this PR.


### Step 3 — Fetch new submitted reviews

Per [`../_shared/github-cli-recipes/submitted-reviews.md`](../_shared/github-cli-recipes/submitted-reviews.md). **Also exclude review ids that appear in `last_seen.escalated_review_ids`** — those have already been escalated and the watcher must not re-dispatch them.

### Step 4 — If one or more new reviews → dispatch (reviews preempt CI)

The watcher does **not** classify. Classification, batching, replying, escalation, and cycle execution all live in `/muggle-do`. The watcher's job is to hand over the list of new review ids and exit.

1. Reset `last_seen.idle_tick_count` to 0.
2. Dispatch `/muggle-do` with an *address-reviews* directive carrying:
   - PR URL (from `prs.json[0].url`)
   - Session slug (from the invocation arguments)
   - Every new review id from Step 3, as a space-separated list

   Exact phrasing belongs to `/muggle-do`'s intent-routing. A reasonable shape is:
   ```
   /muggle-do address reviews <id1> <id2> ... on <pr-url> slug=<slug>
   ```
3. Append a dispatching line to `followup.log` per [`output-templates/watcher-log.md`](output-templates/watcher-log.md).
4. Emit a `tick` event with `reviews_seen: <count>`, `dispatched_review_ids: [<id>, ...]`.
5. Exit. **Reviews preempt CI** — when reviews land, this tick dispatches address-reviews and never polls CI. The cron keeps firing; the next tick still arrives. The watcher only self-unschedules in Step 2 (terminal).

### Step 5 — No new reviews → poll CI for the head SHA

Fetch the check-run rollup for `prs.json[0].head_sha` per [`../_shared/github-cli-recipes/pr-checks.md`](../_shared/github-cli-recipes/pr-checks.md), then:

- **Any check still pending** (`bucket == "pending"`) → idle (wait for checks to settle).
- **All checks green / skipped, or no checks** → idle (green path).
- **One or more checks red** (`bucket == "fail"`), **and** `ci_fix_attempts[head_sha] < 3`, **and** `head_sha` ∉ `ci_escalated_shas` → dispatch and exit:
  1. Reset `last_seen.idle_tick_count` to 0.
  2. Dispatch `/muggle-do` with a *fix-ci* directive carrying the PR URL, slug, and the red check names (no review ids):
     ```
     /muggle-do fix ci <check-1> <check-2> ... on <pr-url> slug=<slug>
     ```
  3. Append a dispatching line to `followup.log`; emit a `tick` event with `checks_red: <count>`, `dispatched_ci_fix: true`.
  4. Exit. The next tick re-checks CI on the new head SHA — CI itself is the verify loop.
- **One or more red, but `ci_fix_attempts[head_sha] >= 3` or `head_sha` ∈ `ci_escalated_shas`** → idle. The fix budget is spent; `/muggle-do`'s fix-ci stage already recorded the escalation. The watcher does not re-dispatch.

### Step 6 — Idle

Any idle branch (Steps 4–5 that did not dispatch): increment `last_seen.idle_tick_count`, append an idle line to `followup.log` per [`output-templates/watcher-log.md`](output-templates/watcher-log.md), emit a `tick` event with `idle: true`, `reviews_seen: 0`, `dispatched_review_ids: []`, `checks_red: <count or 0>`, `dispatched_ci_fix: false`. Exit. The next tick fires in 1 min via `/loop`.

## Output

No console output beyond the turn preamble and (if Step 5 fires) the `/muggle-do` dispatch. The watcher is invisible to the reviewer.
