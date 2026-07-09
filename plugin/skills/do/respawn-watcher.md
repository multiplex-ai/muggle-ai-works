# Respawn the watcher

The single, guaranteed watcher restart shared by every watcher-dispatched `/muggle-do` mode — address-reviews, fix-ci, and rebase. The watcher cancels its own cron the moment it dispatches a cycle ([`../muggle-pr-followup/contract.md`](../muggle-pr-followup/contract.md) Steps 4 / 5 / 5b), so for the duration of the cycle **no cron is armed for this slot**. Respawning is what arms the next one. This is a runtime dispatch of the watcher's slash command, not a doc dependency on it — allowed per the one-way rule in [`../CLAUDE.md`](../CLAUDE.md).

## The guarantee

Respawn is the **last action on every exit path that leaves the PR open** — the happy path *and* every escalation, early-exit, or abort. Since the dispatch already cancelled the cron, any open-PR exit that skips respawn leaves the slot with no cron and no next tick: the poller stops silently and stays stopped until a session restart or a reconcile sweep re-arms it. That silent stop is the exact failure this file exists to prevent, so treat "did I respawn on this branch?" as a checklist item on every exit, not only the success case.

The one exception is a **terminal** PR (merged or closed): a terminal PR needs no watcher, so the terminal branch finalizes instead of respawning.

## Procedure

Run as the final action of the turn:

1. **Refresh PR state** — `github` per [`../_shared/vcs/github/pr-metadata.md`](../_shared/vcs/github/pr-metadata.md), `gitlab` per [`../_shared/vcs/gitlab/mr-metadata.md`](../_shared/vcs/gitlab/mr-metadata.md).
2. **If merged or closed** → write `result.md` per [`../muggle-pr-followup/state-schemas.md`](../muggle-pr-followup/state-schemas.md#resultmd) and **do not respawn**. The PR is terminal; the watcher's job is done.
3. **Otherwise** → dispatch, verbatim, as the turn's last action:

   ```
   /loop 1m /muggle:muggle-pr-followup <slug> <n>
   ```

   Exactly one cron results — the dispatch already cancelled the prior one, so this is never a duplicate. The next tick self-records the new cron id ([`../muggle-pr-followup/record-cron-id.md`](../muggle-pr-followup/record-cron-id.md)).

## Recovery net

This helper guarantees respawn on the paths that reach it, but a cycle that crashes or errors out *before* its exit path can still drop the respawn. [`../muggle-pr-followup/reconcile.md`](../muggle-pr-followup/reconcile.md) is the backstop: it re-arms any open slot whose watcher went silent (no tick within the staleness window), recovering a dropped respawn on the next sweep.
