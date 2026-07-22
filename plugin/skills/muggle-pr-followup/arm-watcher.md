# Arming the Watch

How an orchestrating session starts — or resumes — the watch on one PR. Every arming point runs this same sequence: [`bootstrap.md`](bootstrap.md) Step 8, [`auto-track.md`](auto-track.md) Step 6, and the executor's post-cycle respawn.

1. **Drain.** Run one tick per [`contract.md`](contract.md). It acts on everything already outstanding — actionable threads, body-only reviews past the watermark, a stale branch, red CI — and finalizes a terminal PR. If the tick dispatched a cycle, stop here: the cycle's exit path re-arms when it finishes.
2. **Watch.** PR still open and nothing dispatched → on the first arm, spawn the [`pr-watcher`](../../agents/pr-watcher.md) agent named `PR #<n> — <title>`; on every later arm, send that same agent a resume message. One watcher per PR, for the PR's whole life: it baselines when it wakes, reports on new comment activity / a terminal PR / a failed fetch, then pauses until resumed. If the agent no longer exists — its session ended, or it was killed — spawn a fresh one: the poller holds nothing durable, so everything it needs is re-derived from the slot and live provider state.
3. **On report.** `NEW_COMMENT` or `TERMINAL` → step 1: the tick derives what changed from live provider state, and a terminal PR finalizes there. `ERROR` → surface the reason; [`reconcile.md`](reconcile.md) re-arms the slot on its next sweep.

Every cycle ends with this arming — including cycles the orchestrator started without a watcher report. A cycle that skips the resume leaves the watcher's baseline stale, and its next detection will be the loop's own reply.

Drain-then-watch is the invariant, and it is why the drain precedes every resume, not just the first: the watcher re-baselines when it wakes, so feedback that landed while a cycle ran would slip under the fresh baseline. The tick is the one component that checks live state with the real semantics — marker rule, watermark, attempt budgets — that the poller deliberately lacks.
