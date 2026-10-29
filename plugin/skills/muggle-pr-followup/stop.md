# Stop Procedure

The procedure for the **stop mode** of `muggle-pr-followup` — the owner's kill switch. One command tears down every polling substrate a slot has (loop, cron) and leaves the slot in a state where anything that survives teardown — an orphaned cron in an unreachable scheduler, a queued fire still draining — arrives as an inert one-line absorb ([`contract.md`](contract.md) Step 0). Routing is in [`SKILL.md`](SKILL.md#routing).

Stopping is not finalizing: the PR stays open on the provider, and no `result.md` is written. A stopped slot can be resumed later by renaming `<slug>.stopped` back to `<slug>` and re-arming per [`arm-watcher.md`](arm-watcher.md).

## Input

`$ARGUMENTS` is `stop`, optionally followed by a `<slug>` to scope to one slot. No slug stops **every** open slot and writes the global kill file.

## Procedure

Run per slot in scope (every dir under `~/.muggle-ai/muggle-do/sessions/` with a `prs.json` and no `result.md`, or just the named one):

1. **Stop the loop.** `TaskStop` the background task whose command references this slot — `pr-watch-arm.sh --slot <slot>`, or a legacy `<slot>/watch.sh`. On Windows also kill surviving grandchildren: `TaskStop` reaps the wrapper but the inner loop process can outlive it and keep touching `watch-heartbeat` — enumerate processes whose command line carries this slot's `--slot` path (or a legacy `<slug>/watch.sh`) and kill them. A survivor here also blocks the Step 3 rename (open handles inside the dir).
2. **Cancel the cron.** Per [`cancel-cron.md`](cancel-cron.md) — recorded-id first, `CronList` match as fallback. A cron neither can reach is orphaned; it stays inert via the absorb and dies with its session.
3. **Mark the slot stopped.** Rename `~/.muggle-ai/muggle-do/sessions/<slug>/` → `<slug>.stopped/`. This single rename is the load-bearing act: the tick absorb keys on it, [`reconcile.md`](reconcile.md) skips `*.stopped` dirs, and the muggle watch service ignores a stopped slot's [`watch-registration.json`](state-schemas.md#watch-registrationjson), so no recovery path of any kind re-arms the slot. To keep a watch running but stop the service from resuming its owner, use `muggle watch unregister --slot <slot>` instead.

Then, for a no-slug (stop-everything) invocation only:

4. **Write the global kill file.** `~/.muggle-ai/muggle-do/polling.disabled` (empty file). Ticks absorb on it before even resolving a slot, and reconcile's re-arm step refuses while it exists. Bootstrap deliberately ignores it — pasting a PR URL is an explicit request to watch, and it removes the kill file as its first act so the new watch isn't stillborn.

## Output

One line per slot (`stopped: <slug> — loop <killed|none>, cron <cancelled|orphaned|none>`), plus `polling disabled globally` when the kill file was written. Report an orphaned cron honestly: it may keep firing one-line absorbs until its host session ends — that is the harness's floor, not a teardown failure.

## Invariants

- **Idempotent.** Stopping a stopped slot is a no-op; re-running never errors.
- **Nothing revives a stopped slot.** Tick, reconcile, and auto-track all treat `*.stopped` as invisible. Only the owner resumes one (rename back + re-arm), and only bootstrap overrides the global kill file.
- **Orphans are inert, never invisible.** The absorb line keeps a firing orphan observable without spending anything on it.
