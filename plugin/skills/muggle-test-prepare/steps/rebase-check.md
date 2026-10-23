# Rebase check

Runs on every invocation — learning runs and replays alike — before anything is checked or started: a saved recipe reuses start commands, never code.

Check each **checkout under test** — the caller's own checkout, plus every `directoryOverrides` checkout — and sync it per [`../../_shared/sync-branch-with-base.md`](../../_shared/sync-branch-with-base.md), which owns the verdicts and the `autoRebase` gate. Use the caller's `base` when it passed one:

```bash
muggle checkout-freshness --cwd "<checkout>" --base "<base>" --json
```

- `FRESH` / `NOT_APPLICABLE` → continue.
- `BEHIND_BASE` → rebase per the gate. Declined or `never` → stop the run before anything starts and report the checkout and `behindBy`.
- `FOREIGN_BASE` → stop, naming the inherited commits.

A stop on a replay is a [hard block](./confirm-recipe.md#hard-block): resolve it with the user. Every other repo's services run from a base checkout, which [resolve-sources](./resolve-sources.md) refreshes instead of syncing.
