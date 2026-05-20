# Telemetry Event Catalog

Canonical shapes for `muggle-local-telemetry-event-emit` events emitted by `/muggle-do` and `muggle-pr-followup`. Emission mechanics live in [`telemetry-emit.md`](telemetry-emit.md); this file is the contract for *what* gets emitted.

All events share two top-level fields:

- `skill` — emitting skill name (e.g. `"muggle-pr-followup"`, `"muggle-do"`)
- `event` — sub-event name within the skill (e.g. `"tick"`, `"bootstrap"`, `"cycle"`)

The remaining fields are event-specific (below). Treat missing optional fields as `null`.

## muggle-pr-followup events

### `tick` — one per watcher iteration

Emitted by every watcher tick, idle or not.

```json
{
  "skill": "muggle-pr-followup",
  "event": "tick",
  "session_slug": "<slug>",
  "repo": "<owner>/<repo>",
  "pr_number": <int>,
  "reviews_seen": <int>,
  "dispatched_review_ids": [<int>, ...],
  "terminal": true | false,
  "idle": true | false,
  "tick_duration_ms": <int>
}
```

- `reviews_seen`: count of new submitted reviews past the cursor, before any filtering by escalated set.
- `dispatched_review_ids`: the actual review ids handed to `/muggle-do`. Empty array when idle.
- `terminal`: true when this tick saw the PR merged or closed and wrote `result.md`.
- `idle`: true when no new reviews were seen this tick.

### `bootstrap` — one per successful bootstrap

Emitted on the bootstrap turn after state seeding succeeds and the first watcher is dispatched.

```json
{
  "skill": "muggle-pr-followup",
  "event": "bootstrap",
  "caller": "<caller-name>",
  "session_slug": "<slug>",
  "repo": "<owner>/<repo>",
  "pr_number": <int>,
  "cursor_review_id": <int>,
  "resume": true | false
}
```

- `caller`: who invoked bootstrap. `"user"` for direct invocation; or another skill name if relayed.
- `cursor_review_id`: 0 if the PR had no prior submitted reviews; otherwise the highest existing review id.
- `resume`: true when `--resume` was used against an existing slot.

## muggle-do events (address-reviews mode)

### `cycle` — one per address-reviews invocation

Emitted at the end of a `/muggle-do` address-reviews invocation, regardless of outcome.

```json
{
  "skill": "muggle-do",
  "event": "cycle",
  "session_slug": "<slug>",
  "repo": "<owner>/<repo>",
  "pr_number": <int>,
  "review_ids_in": [<int>, ...],
  "review_ids_actionable": [<int>, ...],
  "review_ids_ambiguous": [<int>, ...],
  "head_sha_before": "<sha-or-null>",
  "head_sha_after": "<sha-or-null>",
  "outcome": "pushed" | "escalated" | "mixed" | "no-op"
}
```

- `outcome`:
  - `"pushed"` — at least one actionable, no ambiguous, push succeeded.
  - `"escalated"` — all reviews were ambiguous; no push.
  - `"mixed"` — both branches happened in the same invocation.
  - `"no-op"` — all input ids already in the escalated set; no work done.

### `escalation` — one per terminal escalation message

Emitted when `/muggle-do` writes a terminal escalation message to the user. Fires zero or one time per invocation.

```json
{
  "skill": "muggle-do",
  "event": "escalation",
  "session_slug": "<slug>",
  "repo": "<owner>/<repo>",
  "pr_number": <int>,
  "kind": "ambiguous-review" | "design-adjustment",
  "review_ids": [<int>, ...]
}
```

- `kind`:
  - `"ambiguous-review"` — one or more reviews classified ambiguous in this batch.
  - `"design-adjustment"` — mid-cycle the work surfaced a design-level conflict that the cycle cannot resolve.

### `resolve-reminder` — one per resolve-reminder stage run

Emitted after the resolve-reminder stage posts the top-level PR comment. Fires zero or one time per cycle (only when actionables ran).

```json
{
  "skill": "muggle-do",
  "event": "resolve-reminder",
  "session_slug": "<slug>",
  "repo": "<owner>/<repo>",
  "pr_number": <int>,
  "addressed_by_loop": <int>,
  "addressed_by_human": <int>,
  "not_addressed": <int>,
  "comment_posted": true | false
}
```

- `comment_posted`: false when there were zero addressed-by-loop threads (no comment to post); telemetry still emits so dashboards see the scan happened.

