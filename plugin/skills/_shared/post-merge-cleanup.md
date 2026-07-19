# Cleanup After the Change Is Merged

Gated by [`autoCleanup`](../muggle-preferences/preference-gates/autoCleanup.md). Follow the standard procedure in [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md). Fire only after the PR is **merged** — never while it's still open.

On `always`, the steps below run as one pre-authorized sequence (no per-step prompts). Stop on the first failure; do not force.

1. **Remove the worktree — link-safe.** `git worktree remove {worktreePath}`, only if a worktree was used. A worktree's dependency directory (e.g. `node_modules`) is often a **link** — a symlink, or a directory junction on Windows — pointing at a shared dependency tree rather than a real per-worktree copy, so the install isn't duplicated. A recursive or forced delete (`git worktree remove --force`, or an `rm`/`rmdir` that recurses) can **follow that link and delete what it points to**, wiping the shared dependencies and breaking every other worktree that shares them. So **never force-remove a worktree whose dependencies are linked.** First unlink each dependency **link itself** — remove the link, never recurse into its target (use whatever the host OS provides to delete a directory link without following it) — then run a plain, non-recursive `git worktree remove {worktreePath}`. Afterward, confirm the shared dependency tree the link pointed at is still intact.
2. `git branch -d {branch}` — **skip when no worktree was used**: the branch is the user's current live checkout (a bootstrap/auto-track watcher), and the checked-out branch must never be deleted. Then `git push origin --delete {branch}`.
3. Clear `.muggle-ai/` session folders for this branch's runs and stale `/tmp/muggle-prepare-*.log` files. Cloud results stay.
