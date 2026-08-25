# Sync the Branch With Its Base

Bring the working branch up to date with the branch it merges into — before a dev server or E2E run, and before any push that opens or updates a change. Gated by [`autoRebase`](../muggle-preferences/preference-gates/autoRebase.md). Follow the standard procedure in [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md).

## Resolving the base

`base` is the branch the work merges into, which is not automatically the remote default — pre-flight lets the user target a different branch, and once a change exists its `baseRefName` is authoritative. A caller holding a base passes it in; fall back to the remote default only when no target was chosen.

**Fire only when `behind > 0`:**

```bash
git fetch origin
base="${base:-$(git symbolic-ref refs/remotes/origin/HEAD --short | sed 's|origin/||')}"
behind=$(git rev-list --count "HEAD..origin/${base}")
```

Pass `{behind}` and `{base}` to the picker prompts. On `always`:

1. Capture the rollback point: `pre_rebase_sha=$(git rev-parse HEAD)`.
2. `git rebase origin/${base}`.
3. On conflict, branch by [`autoResolveConflicts`](../muggle-preferences/preference-gates/autoResolveConflicts.md):
   - `never` → `git rebase --abort`; stop and report, naming the conflicted files. Never auto-resolve.
   - `always` → hand off to [`resolve-rebase-conflicts.md`](resolve-rebase-conflicts.md) with `pre_rebase_sha` to resolve the conflicts, then run the [`verify-or-rollback-gate.md`](verify-or-rollback-gate.md) with `pre_rebase_sha`; it either proceeds or restores `pre_rebase_sha` and escalates.

## Branches already on the remote

The rebase rewrites history, so a branch the remote already has needs a force-push to land it. Never force-push from here. A caller in that position hands the sync to its own rebase mode, which owns the per-SHA attempt budget and the verify-or-rollback gate wrapped around the force-push.

Stale branches produce false failures and false greens, and a branch that goes stale between validation and push opens a change that cannot merge — that is why this gate exists.
