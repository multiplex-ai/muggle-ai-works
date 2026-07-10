# Blocked-tick procedure

The watcher's conditional path for a PR **blocked pending a human** — a durable block only the user can clear (an escalated rebase or CI budget spent, or an ambiguous review awaiting direction). Entered from [`contract.md`](contract.md) Step 7 (flag), then driven each subsequent tick by Step 2.5 (remind-or-resume). None of this runs on a normal tick: when `last_seen.blocked` is absent, the watcher skips straight through.

**Governing rule — remind at the normal `1m` cadence, never stop.** The poll stays at `1m` whether or not the PR is blocked — a `1m` tick is cheap (one fingerprint check, one line out) and keeps the owner nudged and an external unblock caught within a minute. The `blocked` state changes no cadence; its only job is (a) the reason-specific one-line reminder each tick and (b) fingerprint-based auto-resume. No cadence swap, no separate `reminded` flag — while `blocked` is set, the watcher reminds every tick by definition.

## The fingerprint

The external state a block is waiting on. Recompute from live state each blocked tick:

- `head_sha` — from the tick's [`contract.md`](contract.md) Step 1 refresh.
- `latest_review_id` — `max(id)` over submitted reviews per [`../_shared/vcs/github/submitted-reviews.md`](../_shared/vcs/github/submitted-reviews.md) (`0` if none).
- `ci_digest` — the CI rollup digest for `head_sha` per [`../_shared/vcs/github/pr-checks.md`](../_shared/vcs/github/pr-checks.md): the bucket plus each check's name and conclusion, sorted into one stable string.

Any component moving means the block may have cleared — a new push (`head_sha`, which also clears the per-SHA escalation sets), a new review (`latest_review_id`), or a CI/deploy state change (`ci_digest`, which is how an external staging deploy is caught).

## Flag the block (from Step 7)

When an idle tick is a durable human-block and `last_seen.blocked` is not already set:

1. Increment `last_seen.idle_tick_count`.
2. Write `last_seen.blocked = { reason, since: <now>, fingerprint }` (reuse the `latest_review_id` / `ci_digest` already fetched this tick).
3. **Remind the owner** — emit the one-line reminder per [`output-templates/blocked-reminder.md`](output-templates/blocked-reminder.md): the pending act plus a reference back to the decision context.
4. Append a `blocked reason=<reason>` line to `followup.log` per [`output-templates/watcher-log.md`](output-templates/watcher-log.md); emit a `tick` event with `idle: true`, `blocked: true`, and the same other fields as a transient idle. Exit. The `1m` cron is unchanged — no swap.

## Remind or resume (the Step 2.5 gate)

Every subsequent tick while `last_seen.blocked` is present: recompute the fingerprint and compare to `last_seen.blocked.fingerprint`.

- **Unchanged** → still blocked. Re-emit the one-line reminder per [`output-templates/blocked-reminder.md`](output-templates/blocked-reminder.md). Increment `last_seen.idle_tick_count`, append a `blocked reason=<reason>` line to `followup.log`, emit a `tick` event with `idle: true`, `blocked: true`. Exit. The `1m` cron is unchanged.
- **Changed** → clear `last_seen.blocked` and **fall through to [`contract.md`](contract.md) Step 3** to re-evaluate against the moved state this same tick. The cron is already `1m`, so no swap is needed: if Step 3–6 dispatches, that cancels the `1m` cron and `/muggle-do` respawns `1m` (normal single-thread); if it idles transient, the `1m` cron is already correct; if it idles back into the block, Step 7 re-flags.

## Invariants

- Cadence is `1m` whether blocked or active — the block never changes the poll interval. There is no cadence swap, so a blocked slot is never left cron-less by one.
- The poll never stops — a blocked tick keeps firing and reminding; only a terminal PR or an explicit teardown removes the cron.
- Every blocked tick emits exactly one owner reminder (implied by `blocked: true`, no separate flag) and no PR-side post.
- The block clears the instant any fingerprint component moves; an external unblock is caught within one `1m` tick.
