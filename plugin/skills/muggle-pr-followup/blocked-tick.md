# Blocked-tick procedure

The watcher's conditional path for a PR **blocked pending a human** — a durable block only the user can clear (an escalated rebase or CI budget spent, or an ambiguous review awaiting direction). Entered from [`contract.md`](contract.md) Step 7 (flag), then driven each subsequent tick by Step 2.5 (remind-or-resume). None of this runs on a normal tick: when `last_seen.blocked` is absent, the watcher skips straight through.

**Governing rule — slow to `5m` while blocked, but never stop.** Nothing the watcher does moves a human-blocked PR, so a `1m` poll spends its cost catching an external unblock a few minutes sooner than a `5m` poll would — a poor trade against firing 5× as often across a block that can stand for days. So while blocked the watcher **backs off to a `5m` cadence** and turns each (now 5-minutely) tick into a one-line reminder, resuming the responsive `1m` cadence the instant the block clears. The poll never stops: it keeps the owner aware of the pending act until they answer, and still catches an external unblock within one 5-minute tick.

## Cadence swap

The blocked path polls at `5m`; the active path at `1m`. Both flag (Step 7) and resume (Step 2.5) change cadence by cancel-then-create — never leave the slot with no cron:

1. Cancel the current cron per [`cancel-cron.md`](cancel-cron.md) (recorded-id-first, so it dies even after `CronList` goes blind).
2. `CronCreate` a new recurring cron for the **same** command `/muggle:muggle-pr-followup <slug> <n>` at the target cadence — `*/5 * * * *` to slow down when flagging, `* * * * *` to restore `1m` when resuming. Call the `CronCreate`/`CronDelete` **tools**, never a shell (see [`cancel-cron.md`](cancel-cron.md)).
3. Record the new job's id, the new `interval` (`"5m"` or `"1m"`), and `recorded_at` to `cron.json` — a whole-file rewrite per [`state-schemas.md`](state-schemas.md#cronjson), never the Edit tool.

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
3. **Slow to `5m`** — run the cadence swap above with target `*/5 * * * *`, recording `interval: "5m"` to `cron.json`.
4. **Remind the owner** — emit the one-line reminder per [`output-templates/blocked-reminder.md`](output-templates/blocked-reminder.md): the pending act plus a reference back to the decision context.
5. Append a `blocked reason=<reason>` line to `followup.log` per [`output-templates/watcher-log.md`](output-templates/watcher-log.md); emit a `tick` event with `idle: true`, `blocked: true`, `reminded: true`, `interval: "5m"`, and the same other fields as a transient idle. Exit.

## Remind or resume (the Step 2.5 gate)

Every subsequent tick while `last_seen.blocked` is present: recompute the fingerprint and compare to `last_seen.blocked.fingerprint`.

- **Unchanged** → still blocked. Re-emit the one-line reminder per [`output-templates/blocked-reminder.md`](output-templates/blocked-reminder.md). Increment `last_seen.idle_tick_count`, append a `blocked reason=<reason>` line to `followup.log`, emit a `tick` event with `idle: true`, `blocked: true`, `reminded: true`, `interval: "5m"`. Exit. The `5m` cron is unchanged — already slowed, no swap needed.
- **Changed** → **restore `1m`** first: run the cadence swap above with target `* * * * *`, recording `interval: "1m"` to `cron.json`. Then clear `last_seen.blocked` and **fall through to [`contract.md`](contract.md) Step 3** to re-evaluate against the moved state this same tick. Restoring the cron before falling through is what keeps the slot armed: if Step 3–6 dispatches, that cancels the fresh `1m` cron and `/muggle-do` respawns `1m` (normal single-thread); if it idles transient, the `1m` cron is already correct; if it idles back into the block, Step 7 re-flags and re-slows to `5m`.

## Invariants

- Cadence is `5m` while blocked, `1m` while active. Every flag slows the cron to `5m`; every resume restores it to `1m`. The swap is cancel-then-create, so the slot is never left cron-less.
- The poll never stops — blocked backs off but keeps firing; only a terminal PR or an explicit teardown removes the cron.
- Every blocked tick emits exactly one owner reminder (`reminded: true`) and no PR-side post.
- The block clears the instant any fingerprint component moves; an external unblock is caught within one `5m` tick.
