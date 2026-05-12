# Worktrees for Development

General guidance for using git worktrees during development. The decision to fire is owned by the [`autoUseWorktree`](../muggle-preferences/preference-gates/autoUseWorktree.md) gate; this doc is the "how" once that gate says yes.

## Pattern

- **One worktree per branch.** Don't reuse a long-lived checkout across branches — dev servers tie to a single directory and pick up stale bundles on `git checkout`.
- **Parallel is OK** when each worktree has its own dev-server port and isolated test user / DB. Default to sequential when in doubt.

## Create

```bash
git worktree add <repo>-worktrees/<slug> -b <branch>
```

## Set up the dev server

Env file, `npm install`, port, readiness — owned by [`../muggle-test-prepare/SKILL.md`](../muggle-test-prepare/SKILL.md).

## Tear down

After the PR merges — see [`post-merge-cleanup.md`](post-merge-cleanup.md).
