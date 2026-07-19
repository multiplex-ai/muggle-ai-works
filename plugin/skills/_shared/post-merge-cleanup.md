# Cleanup After the Change Is Merged

Gated by [`autoCleanup`](../muggle-preferences/preference-gates/autoCleanup.md). Follow the standard procedure in [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md). Fire only after the PR is **merged** — never while it's still open.

On `always`, the steps below run as one pre-authorized sequence (no per-step prompts). Stop on the first failure; do not force.

1. **Remove the worktree — link-safe.** `git worktree remove {worktreePath}`, only if a worktree was used. A worktree's dependency dir (e.g. `node_modules`) is often a **link** (symlink, or a Windows junction) to a shared tree, not a real copy — and a forced/recursive delete follows the link and wipes that shared target, breaking every worktree. So never `--force`: unlink the dependency link first (remove the link only, using the host OS's unlink), then a plain `git worktree remove {worktreePath}`.
2. `git branch -d {branch}` — **skip when no worktree was used**: the branch is the user's current live checkout (a bootstrap/auto-track watcher), and the checked-out branch must never be deleted. Then `git push origin --delete {branch}`.
3. Clear `.muggle-ai/` session folders for this branch's runs and stale `/tmp/muggle-prepare-*.log` files. Cloud results stay.
