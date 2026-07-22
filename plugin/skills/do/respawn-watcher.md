# Respawn the watcher

The single, guaranteed watcher restart shared by every watcher-dispatched `/muggle-do` mode — address-reviews, fix-ci, and rebase. Dispatch ends the active watch ([`../muggle-pr-followup/contract.md`](../muggle-pr-followup/contract.md) Steps 4 / 5 / 6), so for the duration of the cycle nothing watches this PR. Respawning is what arms the next watch. This is a runtime dispatch of the watcher's arming, not a doc dependency on its caller — allowed per the one-way rule in [`../CLAUDE.md`](../CLAUDE.md).

## The guarantee

Respawn is the **last action on every exit path that leaves the PR open** — the happy path *and* every escalation, early-exit, or abort. Any open-PR exit that skips respawn leaves the slot with nothing watching: the PR sits silent until a session restart or a reconcile sweep re-arms it. That silent stop is the exact failure this file exists to prevent, so treat "did I respawn on this branch?" as a checklist item on every exit, not only the success case.

## Procedure

As the final action of the turn, arm per [`../muggle-pr-followup/arm-watcher.md`](../muggle-pr-followup/arm-watcher.md). Its drain tick finalizes a terminal PR (merged or closed — no watch needed), dispatches a follow-on cycle if feedback arrived while this one ran, or resumes the poller.

A cycle is not finished while its per-comment replies are unposted. A blocked reply — e.g. GitHub refuses with 422 while the reviewer's own pending review is open — escalates to the owner and holds this arming until the replies land. Never resume the watch over unposted replies.

## Recovery net

This helper guarantees respawn on the paths that reach it, but a cycle that crashes or errors out *before* its exit path can still drop the respawn. [`../muggle-pr-followup/reconcile.md`](../muggle-pr-followup/reconcile.md) is the backstop: it re-arms any open slot whose watcher went silent (no tick within the staleness window), recovering a dropped respawn on the next sweep.
