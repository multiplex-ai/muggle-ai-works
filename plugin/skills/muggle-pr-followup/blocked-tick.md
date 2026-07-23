# Blocked-tick procedure

The watcher's conditional path for a PR **blocked pending a human** — a durable block only the user can clear (an escalated rebase or CI budget spent, or an ambiguous review awaiting direction). Entered from [`contract.md`](contract.md) Step 7 (flag), then driven on each subsequent tick by Step 2.5 (resume gate). None of this runs on a normal tick: when `last_seen.blocked` is absent, the watcher skips straight through.

**Governing rule — one reminder per block, and the watch never stops.** The tick that flags the block reminds the owner once; every later blocked tick is silent. The watch keeps standing — the monitor stays visible, and ticks still run at their normal cadence (historically `1m`) whenever a wake or recovery cron fires — with fingerprint-based auto-resume clearing the block the moment external state moves. No repeat nagging, no cadence swap, no separate `reminded` flag: `blocked` present means the reminder has already been sent.

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
3. **Remind the owner** — emit the one-line reminder per [`output-templates/blocked-reminder.md`](output-templates/blocked-reminder.md): the pending act plus a reference back to the decision context. This is the block's **only** reminder.
4. Append a `blocked reason=<reason>` line to `followup.log` per [`output-templates/watcher-log.md`](output-templates/watcher-log.md); emit a `tick` event with `idle: true`, `blocked: true`, and the same other fields as a transient idle. Exit.

## Remind or resume (the Step 2.5 gate)

Every subsequent tick while `last_seen.blocked` is present: recompute the fingerprint and compare to `last_seen.blocked.fingerprint`.

- **Unchanged** → still blocked. Stay **silent** — the reminder went out when the block was flagged. Increment `last_seen.idle_tick_count`, append a `blocked reason=<reason>` line to `followup.log`, emit a `tick` event with `idle: true`, `blocked: true`. Exit.
- **Changed** → clear `last_seen.blocked` and **fall through to [`contract.md`](contract.md) Step 3** to re-evaluate against the moved state this same tick: a dispatch hands the PR to the cycle (its exit settles the watch); a transient idle changes nothing; idling back into a block re-flags per Step 7 — a new block, which sends its own single reminder.

## Invariants

- One reminder per block — sent when flagged, never repeated while the same block holds. A re-flag after a resume is a new block and sends its own single reminder.
- The watch never stops — a blocked PR stays visibly watched at the normal `1m` cadence; only a terminal PR or an explicit teardown ends it.
- The block clears the instant any fingerprint component moves, caught at the next wake or tick.
- The blocked path never posts to the PR.
