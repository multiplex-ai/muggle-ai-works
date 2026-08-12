# Reconcile Procedure

The procedure for the **reconcile mode** of `muggle-pr-followup` — a sweep that finalizes session slots whose PR went terminal while polling was lapsed, and re-arms open slots whose watcher stopped silently (a dropped respawn). Routing is in [`SKILL.md`](SKILL.md#routing).

Termination is otherwise tick-driven ([`contract.md`](contract.md) Step 2): a slot finalizes only when a tick fires and observes `MERGED` / `CLOSED`. If the tick stream stops first — the recurring `/loop` cron auto-expires after 7 days, the session ends, or the machine is off when the PR merges — no tick catches the transition, and the slot is left un-finalized: no `result.md`, no post-merge cleanup, and a surviving cron would keep polling a dead PR. Reconcile is the catch-up.

## Triggers

Three ways in, all running the same procedure:

- **Manual** — `/muggle:muggle-pr-followup reconcile` (or `sweep`).
- **Auto-track** — the top of a no-arg invocation ([`auto-track.md`](auto-track.md)).
- **Session start** — the `reconcile-stale-watchers.sh` hook ([`../../hooks/README.md`](../../hooks/README.md)) runs this sweep, catching a watcher that died with its session (end, or 7-day `/loop` cron expiry) before its PR's merge was observed.

Two invariants hold on every trigger, however the sweep was reached: it never seeds a first watcher, and it never re-arms a slot this session does not own (see Invariants). A no-arg auto-track and a session-start nudge are the two paths that fire without the user naming a PR, so they are exactly the ones that must not widen what the session watches.

## Watching is session-scoped

A watcher lives and dies with its session: monitors and `/loop` crons are both session-bound, so a session that ends or hits its usage limit takes every watch down with it. Nothing polls out of session — there is no detached daemon. This is deliberate: a review is addressed only inside a session that carries the context to address it, never by a headless process that would reply without that context.

**Ownership is session-scoped too, and that is what bounds recovery.** Each slot records the session that armed it in [`owner.json`](state-schemas.md#ownerjson). Step 3.6 re-arms only slots the running session owns — watchers it armed itself, whose poller died under it. A slot owned by another session, or by none, is **never** re-armed here however dead its poller looks. The same argument that forbids a headless daemon forbids a fresh session inheriting a stranger's PR: it would be picking up review work it has no context for, on a branch it never built, and every push it made would be as context-blind as the daemon the design already rejected. Adoption exists precisely so that step is a deliberate act by the owner ([`adopt.md`](adopt.md)) rather than a side effect of starting a session.

The cost is real and accepted: a PR whose owning session is gone stops being watched and stays unwatched until someone adopts it. Reconcile makes that visible instead of silent — Step 4 lists every orphan it declined to touch — and it still finalizes an orphan whose PR went terminal, which needs no context at all.

## Input

`$ARGUMENTS` is `reconcile` (or `sweep`), optionally followed by a `<slug>` to scope the sweep to one slot.

## Procedure

### Step 1 — Enumerate and partition slots

List `~/.muggle-ai/muggle-do/sessions/*/` dirs that contain a `prs.json`. Skip any that already have a `result.md` — those are finalized — and any whose dir name ends in `.stopped` — the owner killed those per [`stop.md`](stop.md), and no recovery path may revive them (a `.stopped` dir still holds a `prs.json`, so this name check is the only thing standing between the owner's stop and a resurrected watcher). Scope to a single `<slug>` if the arg gave one.

Read `$CLAUDE_CODE_SESSION_ID` once, then split what remains on each slot's [`owner.json`](state-schemas.md#ownerjson):

- **Owned** — its `session_id` equals this session's. Eligible for every step below, re-arm included.
- **Foreign** — its `session_id` differs, or the file is absent (a legacy slot, or one armed before ownership was recorded). Eligible for finalize (Step 3) and the cron sweep (Step 3.5) only. Step 3.6 never re-arms a foreign slot, and no step may write one's `owner.json` — a sweep that claimed what it touched would adopt the whole disk on first run.

If `$CLAUDE_CODE_SESSION_ID` is unset, treat **every** slot as foreign. A session that cannot identify itself owns nothing, so the sweep degrades to finalize-and-report rather than guessing.

### Step 2 — Refresh live state

For each candidate, fetch the PR per [`../_shared/vcs/github/pr-metadata.md`](../_shared/vcs/github/pr-metadata.md) using `prs.json[0].url`. A `gh` failure on one slot (deleted repo, missing auth) → log it to that slot's `followup.log` and skip; never abort the whole sweep.

### Step 3 — Finalize the terminal ones

For each candidate whose live `state` is `MERGED` or `CLOSED` — **owned or foreign alike** — run [`finalize.md`](finalize.md), which unschedules the cron recorded-id-first per [`cancel-cron.md`](cancel-cron.md), killing it even when `CronList` has gone blind. `finalize.md` dispatches nothing, so a backfilled merge gets no post-merge cleanup — its branch is typically long gone, and the `autoCleanup` gate governs if the user runs cleanup later.

Finalizing is deliberately ownership-free: it writes a `result.md` for a PR that already reached its end state on the provider and stops a dead cron. It resumes no watch, pushes nothing, and reads no review — so none of the context argument that gates re-arming applies, and leaving foreign terminal slots un-finalized would grow the orphan list forever with PRs that merged months ago.

Slots still `open` are carried to Step 3.6, which re-arms the **owned** ones whose watcher went silent.

### Step 3.5 — Sweep orphaned crons

Step 3 kills the cron of every slot it finalized this run. This step catches the crons **finalize can't reach through a slot** — a watcher cron whose session slot was deleted out from under it, or one already-finalized (`result.md` present, skipped in Step 1) whose cron outlived the finalize. Both keep polling a dead or absent PR until the 7-day `/loop` expiry.

Call `CronList`. For every job whose command ends with `/muggle:muggle-pr-followup <slug> <n>`:

- **No session slot for `<slug>`** (`~/.muggle-ai/muggle-do/sessions/<slug>/` is gone) → `CronDelete` it. The slot it belonged to was removed; the cron is a pure orphan.
- **Slot present and terminal** (`result.md` exists, or `prs.json[0].state` is `merged`/`closed`) → `CronDelete` it. A straggler the finalize missed.
- **Slot present and open** → leave it. A live watcher.

This reaches only crons `CronList` still enumerates. A cron that both survived a compaction (invisible to `CronList`) **and** lost its slot (recorded id gone with it) is beyond either mechanism — see the residual note below.

### Step 3.6 — Re-arm a silently-stopped watcher this session owns

The recovery net for a **dropped respawn**: a `/muggle-do` cycle cancels the watcher's cron when it dispatches ([`contract.md`](contract.md) Steps 4 / 5 / 5b) and is responsible for respawning it when the cycle ends, but a cycle that crashes or errors out before it respawns can leave an open slot with no poller and no next tick — the watch stops silently. This step re-arms it.

Consider only the **owned** candidates still `open` after Step 3. A foreign slot is skipped here outright, before any beacon is read — its staleness is not evidence this session should take it, and counting it here is what let a fresh session inherit every watcher on the machine. Collect the foreign ones for Step 4 instead.

For each owned candidate, first check the slot's `watch.pid` ([`state-schemas.md`](state-schemas.md#watchpid)): if it names a live process (`kill -0 "$pid"`), a monitor loop already owns the slot — **leave it, do not re-arm**. Arming a recovery cron on top of a live monitor is exactly the duplicate poller this sweep must avoid, and the PID lease is a direct signal a stale beacon is not. Only when no live watcher holds the lease, fall back to the liveness beacons: the `watch-heartbeat` file's mtime (a live monitor touches it every iteration, even when quiet — [`arm-watcher.md`](arm-watcher.md)) and the newest **tick line** in `followup.log` — a line whose timestamp is followed by `tick` or `stale-tick` (a live `1m` recovery cron logs a tick every fire; fall back to `cron.json.recorded_at` if both are absent). Non-tick lines are **not** beacons: arming announcements (`armed …` / `re-armed …`), cycle notes, and error lines record activity by a session that may already be dead — logging is not polling, and counting them masks a dead watcher for the whole window. If the **freshest beacon is older than 15 minutes**, the poller is gone → re-arm:

- Re-arm per [`arm-watcher.md`](arm-watcher.md) — drain tick, watermark seed, persistent monitor. Append a `re-armed (silent watcher)` line to the slot's `followup.log`. **Never re-arm with a recurring cron**: every cron fire is a full model turn, and the `1m` cadence already lives token-free in the monitor loop. A cron's only legitimate job is delivering a single recovery tick, and [`contract.md`](contract.md) Step 7.5 converts even that back to a monitor. Skip re-arming entirely while the global kill file `~/.muggle-ai/muggle-do/polling.disabled` exists ([`stop.md`](stop.md)).

A fresh beacon (within the window) means the poller is alive — a quiet monitor still touching its heartbeat, or a cron `CronList` has gone blind to (which hands itself back to a monitor on its next tick — [`contract.md`](contract.md) Step 7.5) — so this step leaves it untouched; re-arming can never double an already-live poller. This recovers only a slot that was **already being watched**; a PR that never had a watcher is seeded by [`auto-track.md`](auto-track.md) / bootstrap, not here.

### Step 4 — Report

One line: slots scanned, finalized (with final state each), left open, re-armed (silently-stopped watchers recovered), and orphan crons swept. Silent only when zero slots exist and nothing was swept.

When any **foreign** open slot remains, add one line naming them and how to take one back:

```
orphaned (other sessions): <slug> → <owner>/<repo>#<n>, …  — adopt with /muggle:muggle-pr-followup adopt <slug>
```

List them once, as fact. Do **not** offer to adopt, pick a likely candidate, or adopt one because it looks important or recently active — the whole point of the gate is that taking a stranger's PR is the user's call, and a sweep that nudges toward adoption every session start relitigates that call until someone says yes.

## Invariants

- **Idempotent.** A slot with `result.md` is never re-finalized; a still-ticking open slot is never re-armed; once everything terminal is swept and every open watcher is live, re-running is a no-op.
- **Recover, don't seed.** Reconcile finalizes terminal slots, sweeps orphan crons, and re-arms an open slot whose watcher went silent (a dropped respawn — Step 3.6). It never arms a PR that was never watched — seeding a first watcher is [`auto-track.md`](auto-track.md)'s / bootstrap's job.
- **Never adopts.** No path through this sweep re-arms a slot another session owns, or writes `owner.json` for a slot it did not already own. Running reconcile in a brand-new session re-arms exactly nothing, and running it a hundred times never widens what that session watches. Ownership changes only through [`adopt.md`](adopt.md), on the user's explicit instruction.
- **Per-slot isolation.** One slot's `gh` failure never blocks finalizing the others.
- **Residual orphan.** A cron that survived a compaction (blind to `CronList`) whose slot was also deleted has no on-disk id left to `CronDelete` and no `CronList` entry to match — only a session restart clears it. Recording the id durably while the slot lives ([`record-cron-id.md`](record-cron-id.md)) shrinks this window to slots removed before their first tick.
