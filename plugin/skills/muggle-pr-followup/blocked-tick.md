# Blocked-tick procedure

The watcher's conditional path for a PR **blocked pending a human** — a durable block only the user can clear (an escalated rebase or CI budget spent, or an ambiguous review awaiting direction). Entered from [`contract.md`](contract.md) Step 7 (flag), then driven each subsequent tick by Step 2.5 (remind-or-resume). None of this runs on a normal tick: when `last_seen.blocked` is absent, the watcher skips straight through.

**Governing rule — never slow or stop the poll.** The watcher stays on the responsive `1m` cadence while blocked and turns each blocked tick into a one-line reminder, rather than backing off. Nothing the watcher does moves a human-blocked PR, so the value of continuing to poll is twofold: keep the owner aware of the pending act until they answer, and catch an external unblock within a minute. Cost stays bounded because each blocked tick is cheap — a fingerprint check and one line out, not a full re-evaluation.

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
4. Append a `blocked reason=<reason>` line to `followup.log` per [`output-templates/watcher-log.md`](output-templates/watcher-log.md); emit a `tick` event with `idle: true`, `blocked: true`, `reminded: true`, and the same other fields as a transient idle. The `1m` cron is unchanged — no cadence swap, no re-arm. Exit.

## Remind or resume (the Step 2.5 gate)

Every subsequent tick while `last_seen.blocked` is present: recompute the fingerprint and compare to `last_seen.blocked.fingerprint`.

- **Unchanged** → still blocked. Re-emit the one-line reminder per [`output-templates/blocked-reminder.md`](output-templates/blocked-reminder.md). Increment `last_seen.idle_tick_count`, append a `blocked reason=<reason>` line to `followup.log`, emit a `tick` event with `idle: true`, `blocked: true`, `reminded: true`. Exit. The `1m` cron is unchanged — no cron swap, no re-arm.
- **Changed** → clear `last_seen.blocked` and **fall through to [`contract.md`](contract.md) Step 3** to re-evaluate against the moved state this same tick. Safe because the cadence was `1m` throughout — no slowed cron to swap, no double-arm: if Step 3–6 dispatches, that is the normal single-thread stop-and-respawn; if it idles back into the block, Step 7 re-flags it.

## Invariants

- Cadence is always `1m` — blocked never backs off to a slow interval, and never swaps the cron.
- Every blocked tick emits exactly one owner reminder (`reminded: true`) and no PR-side post.
- The block clears the instant any fingerprint component moves; an external unblock is caught within one minute.
