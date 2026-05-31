# Rebase Onto the Default Branch Before Dev Server / E2E

Gated by [`autoRebase`](../muggle-preferences/preference-gates/autoRebase.md). Follow the standard procedure in [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md).

**Fire only when `behind > 0`:**

```bash
git fetch origin
default=$(git symbolic-ref refs/remotes/origin/HEAD --short | sed 's|origin/||')
behind=$(git rev-list --count "HEAD..origin/${default}")
```

Pass `{behind}` and `{default}` to the picker prompts. On `always`:

1. Capture the rollback point: `pre_rebase_sha=$(git rev-parse HEAD)`.
2. `git rebase origin/${default}`.
3. On conflict, branch by [`autoResolveConflicts`](../muggle-preferences/preference-gates/autoResolveConflicts.md):
   - `never` (default) → `git rebase --abort`; stop and report, naming the conflicted files. Never auto-resolve.
   - `always` → hand off to [`resolve-rebase-conflicts.md`](resolve-rebase-conflicts.md) with `pre_rebase_sha`; it resolves, runs the verify-or-rollback gate, and either proceeds or restores `pre_rebase_sha` and escalates.

Stale branches produce false failures and false greens — that's why this gate exists.
