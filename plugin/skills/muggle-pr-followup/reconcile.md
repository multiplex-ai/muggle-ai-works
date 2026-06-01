# Reconcile Procedure

The procedure for the **reconcile mode** of `muggle-pr-followup` — a sweep that finalizes session slots whose PR went terminal while polling was lapsed. Routing is in [`SKILL.md`](SKILL.md#routing).

Termination is otherwise tick-driven ([`contract.md`](contract.md) Step 2): a slot finalizes only when a tick fires and observes `MERGED` / `CLOSED`. If the tick stream stops first — the recurring `/loop` cron auto-expires after 7 days, the session ends, or the machine is off when the PR merges — no tick catches the transition, and the slot is left un-finalized: no `result.md`, no post-merge cleanup, and a surviving cron would keep polling a dead PR. Reconcile is the catch-up.

## Input

`$ARGUMENTS` is `reconcile` (or `sweep`), optionally followed by a `<slug>` to scope the sweep to one slot.

## Procedure

### Step 1 — Enumerate slots

List `~/.muggle-ai/muggle-do/sessions/*/` dirs that contain a `prs.json`. Skip any that already have a `result.md` — those are finalized. Scope to a single `<slug>` if the arg gave one.

### Step 2 — Refresh live state

For each candidate, fetch the PR per [`../_shared/github-cli-recipes/pr-metadata.md`](../_shared/github-cli-recipes/pr-metadata.md) using `prs.json[0].url`. A `gh` failure on one slot (deleted repo, missing auth) → log it to that slot's `followup.log` and skip; never abort the whole sweep.

### Step 3 — Finalize the terminal ones

For each candidate whose live `state` is `MERGED` or `CLOSED`, run [`finalize.md`](finalize.md). `finalize.md` dispatches nothing, so a backfilled merge gets no post-merge cleanup — its branch is typically long gone, and the `autoCleanup` gate governs if the user runs cleanup later. Slots still `open` are left untouched — reconcile finalizes, it does not re-arm a watcher (re-arming an open PR is [`auto-track.md`](auto-track.md)'s job).

### Step 4 — Report

One line: slots scanned, finalized (with final state each), and left open. Silent only when zero slots exist.

## Invariants

- **Idempotent.** A slot with `result.md` is never re-finalized; once everything terminal is swept, re-running is a no-op.
- **Finalize-only.** Reconcile never seeds, re-arms, or dispatches a watcher. Open slots pass through untouched.
- **Per-slot isolation.** One slot's `gh` failure never blocks finalizing the others.
