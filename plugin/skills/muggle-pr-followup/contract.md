# Watcher Per-Tick Contract

The procedure for the **tick mode** of `muggle-pr-followup` — one polling iteration scoped to one PR. The watcher is a dumb pipe: it polls for new submitted reviews, dispatches `/muggle-do` if there are any, and exits. It does not classify, amend requirements, post replies, run cycles, or escalate.

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

1. Mark the entry terminal in `prs.json`.
2. Write `result.md` per [`state-schemas.md`](state-schemas.md#resultmd).
3. Append a terminal line to `followup.log` per [`output-templates/watcher-log.md`](output-templates/watcher-log.md).
4. Emit a `tick` event with `terminal: true` per [`../_shared/telemetry-events/pr-followup-tick.md`](../_shared/telemetry-events/pr-followup-tick.md).
5. **Cancel the cron schedule that fires this watcher.** `/loop 1m ...` from bootstrap was registered via `CronCreate`; a fixed-interval cron keeps firing regardless of whether the skill re-dispatches. Call `CronList`, find any job whose command ends with `/muggle:muggle-pr-followup <slug> <pr-number>` (exact two-arg match), and `CronDelete` it. No-op if none matches — the tick may have been invoked manually rather than via `/loop`.
6. Exit. The watcher has now unscheduled itself; no future ticks will fire for this PR.

### Step 3 — Fetch new submitted reviews

Per [`../_shared/github-cli-recipes/submitted-reviews.md`](../_shared/github-cli-recipes/submitted-reviews.md). **Also exclude review ids that appear in `last_seen.escalated_review_ids`** — those have already been escalated and the watcher must not re-dispatch them.

### Step 4 — If zero new reviews → idle

1. Increment `last_seen.idle_tick_count`.
2. Append an idle line to `followup.log` per [`output-templates/watcher-log.md`](output-templates/watcher-log.md).
3. Emit a `tick` event with `idle: true`, `reviews_seen: 0`, `dispatched_review_ids: []`.
4. Exit. The next tick fires in 1 min via `/loop`.

### Step 5 — If one or more new reviews → dispatch

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
5. Exit. The cron schedule from bootstrap keeps firing the watcher every minute, so the next tick still arrives even though this turn dispatched `/muggle-do`. The watcher only self-unschedules in Step 2 (terminal).

## Output

No console output beyond the turn preamble and (if Step 5 fires) the `/muggle-do` dispatch. The watcher is invisible to the reviewer.
