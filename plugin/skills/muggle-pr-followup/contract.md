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

Read these from `.muggle-do/sessions/<slug>/`:

- `prs.json` — see [`state-schemas.md`](state-schemas.md#prsjson). The watcher touches the single entry whose `number` matches the dispatched PR number.
- `last_seen.json` — see [`state-schemas.md`](state-schemas.md#last_seenjson). Keyed by `"<owner>/<repo>#<n>"`.

If either file is missing or the PR is not in `prs.json`, the tick is a no-op. Log an error line in `followup.log` and exit. The watcher must not be invoked in this state — if it happens, the slot is corrupt.

## Procedure

### Step 1 — Refresh PR state

Use the "PR metadata snapshot" recipe from [`../_shared/github-cli-recipes.md`](../_shared/github-cli-recipes.md). Update `prs.json[0].head_sha` and `prs.json[0].state` from the response.

### Step 2 — Termination check

If `state` is `MERGED` or `CLOSED`:

1. Mark the entry terminal in `prs.json`.
2. Write `result.md` per [`state-schemas.md`](state-schemas.md#resultmd).
3. Append a terminal line to `followup.log` per [`output-templates.md`](output-templates.md#terminal-tick).
4. Emit a `tick` event with `terminal: true` per [`../_shared/telemetry-events.md`](../_shared/telemetry-events.md#tick--one-per-watcher-iteration).
5. Exit. **Do not schedule another tick.** The `/loop` framework stops invoking this skill once it sees no follow-up dispatch.

### Step 3 — Fetch new submitted reviews

Use the "Submitted reviews past a cursor" recipe. Apply the filters listed there. Important: **also exclude review ids that appear in `last_seen.escalated_review_ids`** — those have already been escalated and the watcher must not re-dispatch them.

### Step 4 — If zero new reviews → idle

1. Increment `last_seen.idle_tick_count`.
2. Append an idle line to `followup.log` per [`output-templates.md`](output-templates.md#idle-tick-logged-only-not-printed).
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
3. Append a dispatching line to `followup.log` per [`output-templates.md`](output-templates.md#dispatching-tick-logged-only-not-printed).
4. Emit a `tick` event with `reviews_seen: <count>`, `dispatched_review_ids: [<id>, ...]`.
5. Exit. **Do not schedule another tick.** `/muggle-do` will respawn the watcher at the end of its cycle.

### Step 6 — Self-check before ending the turn

- [ ] `prs.json` reflects the current PR state (head_sha refreshed; terminal marked if applicable).
- [ ] `last_seen.json` reflects the new counter values.
- [ ] `followup.log` has exactly one new line for this tick.
- [ ] Exactly one `tick` telemetry event was emitted.
- [ ] If dispatching, the `/muggle-do` invocation was the last tool call.
- [ ] If terminal, `result.md` exists.

## What the watcher must never do

These are explicit non-responsibilities. The earlier (cycle-declared) shape did all of them; the dumb-pipe shape does none.

- Classify a review as actionable or ambiguous.
- Read or write `cycle.json` or `requirements.md` (those files no longer exist in the slot).
- Iterate cycle steps. Run build/test/E2E commands. Post any PR comment, reply, or walkthrough.
- Maintain `pushed_shas[]` or `cycles_completed` — both belong to `/muggle-do`.
- Escalate. Even on cycle failures `/muggle-do` reports, the watcher is not the escalation site.
- Re-dispatch `/muggle-do` from the same tick that already dispatched it.

When the watcher's behavior seems wrong, the fix is almost always in `/muggle-do`. The watcher's logic is small enough to audit visually.

## Output

This stage produces no console output beyond:

- The turn preamble (always).
- The `/muggle-do` dispatch (only when Step 5 fires).

No escalations, no summary, no PR-side activity. The watcher is invisible to the reviewer.

## Reply / classification / escalation: pointers

For the rules the watcher used to apply (and the new caller of those rules now applies):

- **Classify rule:** [`../_shared/pr-followup-helpers.md`](../_shared/pr-followup-helpers.md). Called by `/muggle-do`, not the watcher.
- **Reviewer allow-list:** same file. Called by `/muggle-do` when reading reviews; the watcher fetches by `id` only and does not allow-list filter.
- **Reply routing (per-comment inline replies):** same file. Owned by `/muggle-do`.
- **Escalation message templates:** [`output-templates.md`](output-templates.md). Posted by `/muggle-do`.
