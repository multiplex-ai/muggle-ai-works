# Worktrees for Development

Reference notes for skills and agents that work with git worktrees.

## Pattern

- **One worktree per branch.** Don't reuse a long-lived checkout across branches — dev servers tie to a single directory and pick up stale bundles on `git checkout`.
- **Parallel is OK** when each worktree has its own dev-server port and isolated test user / DB. Default to sequential when in doubt.

## Create

```bash
git worktree add <repo>-worktrees/<slug> -b <branch>
```

## Tear down

After the work merges — see [`post-merge-cleanup.md`](post-merge-cleanup.md).
