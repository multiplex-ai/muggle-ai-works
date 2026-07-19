# Reconcile Procedure

The procedure for the **reconcile mode** of `muggle-pr-followup` — a sweep that finalizes session slots whose PR went terminal while polling was lapsed, and re-arms open slots whose watcher stopped silently (a dropped respawn). Routing is in [`SKILL.md`](SKILL.md#routing).

Termination is otherwise tick-driven ([`contract.md`](contract.md) Step 2): a slot finalizes only when a tick fires and observes `MERGED` / `CLOSED`. If the tick stream stops first — the recurring `/loop` cron auto-expires after 7 days, the session ends, or the machine is off when the PR merges — no tick catches the transition, and the slot is left un-finalized: no `result.md`, no post-merge cleanup, and a surviving cron would keep polling a dead PR. Reconcile is the catch-up.

## Triggers

Three ways in, all running the same procedure:

- **Manual** — `/muggle:muggle-pr-followup reconcile` (or `sweep`).
- **Auto-track** — the top of a no-arg invocation ([`auto-track.md`](auto-track.md)).
- **Session start** — the `reconcile-stale-watchers.sh` hook ([`../../hooks/README.md`](../../hooks/README.md)). It scans for open slots (a `prs.json` with no `result.md`) and nudges the agent to run this procedure **only when some exist**, staying silent otherwise. The hook can't re-arm anything itself — re-arming needs the `CronCreate` tool, which a shell hook can't call — so it only surfaces the work. This closes the gap where session-only crons die (session end, 7-day expiry) and open PRs accumulate dead watchers with nothing to notice.

Recover-don't-seed holds on every trigger: a session-start run still never seeds a first watcher (see Invariants).

## Input

`$ARGUMENTS` is `reconcile` (or `sweep`), optionally followed by a `<slug>` to scope the sweep to one slot.

## Procedure

### Step 1 — Enumerate slots

List `~/.muggle-ai/muggle-do/sessions/*/` dirs that contain a `prs.json`. Skip any that already have a `result.md` — those are finalized. Scope to a single `<slug>` if the arg gave one.

### Step 2 — Refresh live state

For each candidate, fetch the PR per [`../_shared/vcs/github/pr-metadata.md`](../_shared/vcs/github/pr-metadata.md) using `prs.json[0].url`. A `gh` failure on one slot (deleted repo, missing auth) → log it to that slot's `followup.log` and skip; never abort the whole sweep.

### Step 3 — Finalize the terminal ones

For each candidate whose live `state` is `MERGED` or `CLOSED`, run [`finalize.md`](finalize.md) — which unschedules the cron recorded-id-first per [`cancel-cron.md`](cancel-cron.md), killing it even when `CronList` has gone blind. `finalize.md` dispatches nothing, so a backfilled merge gets no post-merge cleanup — its branch is typically long gone, and the `autoCleanup` gate governs if the user runs cleanup later. Slots still `open` are carried to Step 3.6, which re-arms any whose watcher went silent.

### Step 3.5 — Sweep orphaned crons

Step 3 kills the cron of every slot it finalized this run. This step catches the crons **finalize can't reach through a slot** — a watcher cron whose session slot was deleted out from under it, or one already-finalized (`result.md` present, skipped in Step 1) whose cron outlived the finalize. Both keep polling a dead or absent PR until the 7-day `/loop` expiry.

Call `CronList`. For every job whose command ends with `/muggle:muggle-pr-followup <slug> <n>`:

- **No session slot for `<slug>`** (`~/.muggle-ai/muggle-do/sessions/<slug>/` is gone) → `CronDelete` it. The slot it belonged to was removed; the cron is a pure orphan.
- **Slot present and terminal** (`result.md` exists, or `prs.json[0].state` is `merged`/`closed`) → `CronDelete` it. A straggler the finalize missed.
- **Slot present and open** → leave it. A live watcher.

This reaches only crons `CronList` still enumerates. A cron that both survived a compaction (invisible to `CronList`) **and** lost its slot (recorded id gone with it) is beyond either mechanism — see the residual note below.

### Step 3.6 — Re-arm a silently-stopped open watcher

The recovery net for a **dropped respawn**: a `/muggle-do` cycle cancels the watcher's cron when it dispatches ([`contract.md`](contract.md) Steps 4 / 5 / 5b) and is responsible for respawning it when the cycle ends, but a cycle that crashes or errors out before it respawns can leave an open slot with no cron and no next tick — the poller stops silently. This step re-arms it.

For each candidate still `open` after Step 3, check when its watcher last ticked — the newest ISO-8601 line in `followup.log` (or `cron.json.recorded_at` if the log is empty). If that is **older than 15 minutes** (comfortably beyond the `1m` cadence, so a live cron would have logged many times inside the window), the poller is gone → re-arm:

- `CronCreate` a recurring cron (call the **tool**, never a shell) with `cron: "* * * * *"` and prompt `/muggle:muggle-pr-followup <slug> <n>`, then record its id and `interval: "1m"` to `cron.json` (whole-file rewrite per [`state-schemas.md`](state-schemas.md#cronjson)). Append a `re-armed (silent watcher)` line to the slot's `followup.log`.

A fresh log line (within the window) means the cron is alive — even one `CronList` has gone blind to — so this step leaves it untouched; re-arming can never double an already-live poller. This recovers only a slot that was **already being watched**; a PR that never had a watcher is seeded by [`auto-track.md`](auto-track.md) / bootstrap, not here.

### Step 4 — Report

One line: slots scanned, finalized (with final state each), left open, re-armed (silently-stopped watchers recovered), and orphan crons swept. Silent only when zero slots exist and nothing was swept.

## Invariants

- **Idempotent.** A slot with `result.md` is never re-finalized; a still-ticking open slot is never re-armed; once everything terminal is swept and every open watcher is live, re-running is a no-op.
- **Recover, don't seed.** Reconcile finalizes terminal slots, sweeps orphan crons, and re-arms an open slot whose watcher went silent (a dropped respawn — Step 3.6). It never arms a PR that was never watched — seeding a first watcher is [`auto-track.md`](auto-track.md)'s / bootstrap's job.
- **Per-slot isolation.** One slot's `gh` failure never blocks finalizing the others.
- **Residual orphan.** A cron that survived a compaction (blind to `CronList`) whose slot was also deleted has no on-disk id left to `CronDelete` and no `CronList` entry to match — only a session restart clears it. Recording the id durably while the slot lives ([`record-cron-id.md`](record-cron-id.md)) shrinks this window to slots removed before their first tick.
