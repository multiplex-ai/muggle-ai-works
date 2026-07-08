# Reconcile Procedure

The procedure for the **reconcile mode** of `muggle-pr-followup` — a sweep that finalizes session slots whose PR went terminal while polling was lapsed. Routing is in [`SKILL.md`](SKILL.md#routing).

Termination is otherwise tick-driven ([`contract.md`](contract.md) Step 2): a slot finalizes only when a tick fires and observes `MERGED` / `CLOSED`. If the tick stream stops first — the recurring `/loop` cron auto-expires after 7 days, the session ends, or the machine is off when the PR merges — no tick catches the transition, and the slot is left un-finalized: no `result.md`, no post-merge cleanup, and a surviving cron would keep polling a dead PR. Reconcile is the catch-up.

## Input

`$ARGUMENTS` is `reconcile` (or `sweep`), optionally followed by a `<slug>` to scope the sweep to one slot.

## Procedure

### Step 1 — Enumerate slots

List `~/.muggle-ai/muggle-do/sessions/*/` dirs that contain a `prs.json`. Skip any that already have a `result.md` — those are finalized. Scope to a single `<slug>` if the arg gave one.

### Step 2 — Refresh live state

For each candidate, fetch the PR per [`../_shared/vcs/github/pr-metadata.md`](../_shared/vcs/github/pr-metadata.md) using `prs.json[0].url`. A `gh` failure on one slot (deleted repo, missing auth) → log it to that slot's `followup.log` and skip; never abort the whole sweep.

### Step 3 — Finalize the terminal ones

For each candidate whose live `state` is `MERGED` or `CLOSED`, run [`finalize.md`](finalize.md) — which unschedules the cron recorded-id-first per [`cancel-cron.md`](cancel-cron.md), killing it even when `CronList` has gone blind. `finalize.md` dispatches nothing, so a backfilled merge gets no post-merge cleanup — its branch is typically long gone, and the `autoCleanup` gate governs if the user runs cleanup later. Slots still `open` are left untouched — reconcile finalizes, it does not re-arm a watcher (re-arming an open PR is [`auto-track.md`](auto-track.md)'s job).

### Step 3.5 — Sweep orphaned crons

Step 3 kills the cron of every slot it finalized this run. This step catches the crons **finalize can't reach through a slot** — a watcher cron whose session slot was deleted out from under it, or one already-finalized (`result.md` present, skipped in Step 1) whose cron outlived the finalize. Both keep polling a dead or absent PR until the 7-day `/loop` expiry.

Call `CronList`. For every job whose command ends with `/muggle:muggle-pr-followup <slug> <n>`:

- **No session slot for `<slug>`** (`~/.muggle-ai/muggle-do/sessions/<slug>/` is gone) → `CronDelete` it. The slot it belonged to was removed; the cron is a pure orphan.
- **Slot present and terminal** (`result.md` exists, or `prs.json[0].state` is `merged`/`closed`) → `CronDelete` it. A straggler the finalize missed.
- **Slot present and open** → leave it. A live watcher.

This reaches only crons `CronList` still enumerates. A cron that both survived a compaction (invisible to `CronList`) **and** lost its slot (recorded id gone with it) is beyond either mechanism — see the residual note below.

### Step 4 — Report

One line: slots scanned, finalized (with final state each), left open, and orphan crons swept. Silent only when zero slots exist and nothing was swept.

## Invariants

- **Idempotent.** A slot with `result.md` is never re-finalized; once everything terminal is swept, re-running is a no-op.
- **Finalize-only.** Reconcile never seeds, re-arms, or dispatches a watcher. Open slots pass through untouched.
- **Per-slot isolation.** One slot's `gh` failure never blocks finalizing the others.
- **Residual orphan.** A cron that survived a compaction (blind to `CronList`) whose slot was also deleted has no on-disk id left to `CronDelete` and no `CronList` entry to match — only a session restart clears it. Recording the id durably while the slot lives ([`record-cron-id.md`](record-cron-id.md)) shrinks this window to slots removed before their first tick.
