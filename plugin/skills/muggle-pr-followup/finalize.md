# Finalize a Terminal PR

The shared, **pure** termination sequence for a follow-up slot whose PR is `MERGED` or `CLOSED`. Called by [`contract.md`](contract.md) Step 2 (a tick observed the transition) and [`reconcile.md`](reconcile.md) (a sweep found a slot whose polling lapsed before the transition). One slot, run once.

This step only finalizes — marks the slot terminal, writes the record, unschedules the cron. It **dispatches nothing**. Post-merge cleanup is a separate, caller-owned concern: the tick ([`contract.md`](contract.md)) hands it off; a reconcile backfill skips it.

## Inputs

- `<slug>`, `<owner>/<repo>`, `<n>` — the slot's PR.
- `state` — `MERGED` or `CLOSED`, from a fresh [`../_shared/vcs/github/pr-metadata.md`](../_shared/vcs/github/pr-metadata.md).
- `mergeCommit` + `mergedAt` when `MERGED`.

## Procedure

### Step 1 — Mark the slot terminal

Rewrite `prs.json[0].state` to `merged` / `closed` ([`state-schemas.md`](state-schemas.md#prsjson)). That state plus the `result.md` written next are the terminal marker — there is no separate flag.

### Step 2 — Write `result.md`

Once, per [`state-schemas.md`](state-schemas.md#resultmd). Pull `cycles_completed`, `pushed_shas`, and `escalated_review_ids` from `last_seen.json`.

### Step 3 — Log and telemetry

Append the terminal line per [`output-templates/watcher-log.md`](output-templates/watcher-log.md). Emit one `tick` event with `terminal: true` per [`../_shared/telemetry-events/pr-followup-tick.md`](../_shared/telemetry-events/pr-followup-tick.md).

### Step 4 — Unschedule the cron

Cancel this slot's cron per [`cancel-cron.md`](cancel-cron.md). No-op when none matches — a manually-run tick, or a cron that already expired. Recurring `/loop` crons auto-expire after 7 days; that lapse is the gap [`reconcile.md`](reconcile.md) exists to catch.
