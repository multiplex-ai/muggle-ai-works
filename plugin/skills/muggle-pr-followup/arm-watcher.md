# Arming the Watch

How an orchestrating session starts — or restarts — the watch on one PR. Every arming point runs this same sequence: [`bootstrap.md`](bootstrap.md) Step 8, [`auto-track.md`](auto-track.md) Step 6, and the executor's post-cycle respawn.

1. **Drain.** Run one tick per [`contract.md`](contract.md). It acts on everything already outstanding — actionable threads, body-only reviews past the watermark, a stale branch, red CI — and finalizes a terminal PR. If the tick dispatched a cycle, stop here: the cycle's exit path re-arms when it finishes.
2. **Watch.** PR still open and nothing dispatched → spawn the [`pr-watcher`](../../agents/pr-watcher.md) agent with the repo and PR number, as the turn's last action. It baselines on the activity present at spawn and returns only on new comment activity, a terminal PR, or a failed fetch.
3. **On return.** `NEW_COMMENT` or `TERMINAL` → step 1: the tick derives what changed from live provider state, and a terminal PR finalizes there. `ERROR` → surface the reason; [`reconcile.md`](reconcile.md) re-arms the slot on its next sweep.

Drain-then-watch is the invariant. The tick handles everything up to now, so the poller only needs to see what arrives after its baseline; skipping the drain is how a PR bootstrapped with existing feedback sits silent until the next new review.
