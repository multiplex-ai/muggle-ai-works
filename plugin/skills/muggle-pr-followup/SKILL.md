---
name: muggle-pr-followup
model: haiku
description: "Use when the user wants a pull request's incoming review feedback handled for them — it watches one PR's review thread and, each time a reviewer submits new comments, dispatches the work to address them. Engage on PR-review-follow-up intent: \"watch my PR and address review comments as they come in\", \"keep an eye on PR #123 and respond to reviewer feedback\", \"babysit my PR's review thread\", \"I'm stepping away — handle my PR's reviews while I'm gone\". This is PR-review-specific automation — prefer it over the generic loop skill. It only watches and dispatches; the actual edits and replies are muggle-do. Not for posting test results to a PR (use muggle-pr-visual-walkthrough)."
---

# muggle-pr-followup

> Telemetry first step: see [`../_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-pr-followup"`.

A watcher that babysits one open PR toward **merge-ready** — review threads addressed, CI green, and the branch rebased on its base. Polls for actionable feedback, check-run state, and the branch's standing against its base; when feedback lands, CI goes red, or the branch falls behind or conflicts with its base, hands the work to `/muggle-do` and exits. On merge or close, it hands the terminal wrap-up to `/muggle-do` the same way — teardown when merged, then a next-step suggestion. `/muggle-do` is the executor — it classifies the reviews, fixes the failing checks, or rebases onto the base (resolving any conflicts), pushes, replies per comment, and respawns the watcher.

**The watcher is a dumb pipe.** It does not classify reviews, iterate cycles, post replies, or escalate. All of that lives in `/muggle-do`. See [stage-8 design](../../../../muggle-ai-brain/architecture/2026-05-08-muggle-do-pr-comment-loop-design.md) for the rationale.

**Per-PR isolation.** One watcher per PR. Multi-PR work runs N independent watchers.

**Arming.** Bootstrap, auto-track, and the executor's post-cycle respawn all arm the watch the same way — one drain tick, then one persistent labeled monitor per PR — visible as a running task for as long as the PR is polled, gone at terminal ([`arm-watcher.md`](arm-watcher.md)). Crons are the recovery substrate only ([`reconcile.md`](reconcile.md)).

**One reminder when blocked pending a human.** When a PR can't progress without the user — an escalated rebase/CI budget spent, or an ambiguous review awaiting direction — the tick that flags the block emits **one** one-line reminder: the pending act plus a reference back to the decision context ([`contract.md`](contract.md) Steps 2.5, 7). After that the watch stays visible and silent — no repeat nagging — and the block clears the instant a wake finds a push, review, or CI/deploy state moved.

**Cron lifecycle.** Each tick records its `/loop` cron id to `cron.json` while `CronList` can still see it ([`record-cron-id.md`](record-cron-id.md)), so teardown can delete the cron by id after a session continue / compaction blinds `CronList` to it. Reconcile ([`reconcile.md`](reconcile.md)) sweeps crons whose PR is terminal or whose slot is gone, and re-arms an open slot whose watcher stopped silently.

**Session death.** Monitors and crons are both session-bound — a session that ends or hits its usage limit takes every watch with it, and reconcile's triggers all need a live session. The out-of-session watchdog daemon ([`reconcile.md`](reconcile.md#out-of-session-watchdog)) is the substrate that survives: ensured at session start and at arm time, it reads each slot's liveness beacon (`watch-heartbeat` / `followup.log`), polls dead slots with plain `gh`/`glab` calls (per the slot's provider), and spawns a headless recovery tick when one is owed — retrying through usage-limit windows so watching resumes at limit reset with no user action.

## Routing

The skill recognizes its mode by inspecting `$ARGUMENTS` and falling back to on-disk state. It never runs procedure inline — it identifies the mode and routes to the appropriate procedure file.

| Input | On-disk check | Mode |
| :---- | :------------ | :--- |
| First arg matches `https?://github\.com/[^/]+/[^/]+/pull/\d+` | — | **bootstrap** → [`bootstrap.md`](bootstrap.md) |
| `<slug> <pr-number>` | session dir for `<slug>` exists | **tick** → [`contract.md`](contract.md) |
| `<slug> <pr-number>` | session dir missing | **error:** "no session at `<path>`; pass a PR URL to start one" |
| `<pr-number>` alone | exactly one existing session contains it | **tick** for that PR |
| `<pr-number>` alone | zero or multiple matches | **error:** ambiguous; list candidates and exit |
| empty | — | **auto-track** → [`auto-track.md`](auto-track.md) |
| `help` / `?` | — | **help:** list active loops per [`output-templates/help.md`](output-templates/help.md) |
| `reconcile` / `sweep` (optional `<slug>`) | — | **reconcile** → [`reconcile.md`](reconcile.md) |

Auto-track runs **reconcile** first, so a no-arg invocation also finalizes any slot whose PR merged or closed while its watcher was down (expired cron, ended session) and re-arms any open slot whose watcher stopped silently (a dropped respawn). Reconcile recovers a watcher that was already running; it never seeds a first watcher for a PR — that is auto-track's / bootstrap's job.

**Reconcile also runs at session start** — a `SessionStart` hook ([`../../hooks/README.md`](../../hooks/README.md)) surfaces the sweep when open slots exist, catching a watcher that died with its session (end, or 7-day `/loop` expiry) before a manual sweep would. See [`reconcile.md`](reconcile.md#triggers).

Bootstrap accepts three optional trailing flags:

- `--slug=<name>` — override the default `<repo>-pr<n>` slug
- `--resume` — opt in to reusing an existing session slot (default is refuse on conflict)
- `--forward-only` — pin `lastBodyReviewId` past existing **body-only** reviews (skip history on those). Line-comment threads are always picked up from live thread state, regardless of this flag.

## Preferences

| Preference | Gate |
| :--------- | :--- |
| `autoReuseValidationContext` | Bootstrap reuses an existing validation context instead of re-asking — fired in the Step 6.5 gather per [`../_shared/resolve-e2e-validation-context.md`](../_shared/resolve-e2e-validation-context.md) |

## Folder TOC

See [`CLAUDE.md`](CLAUDE.md) for the one-line index of every file in this folder.
