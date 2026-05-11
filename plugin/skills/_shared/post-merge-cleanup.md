# Cleanup After the Change Is Merged

Gated by [`autoCleanup`](../muggle-preferences/preference-gates/autoCleanup.md). Follow the standard procedure in [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md). Fire only after the PR is **merged** — never while it's still open.

On `always`, the four steps below run as one pre-authorized sequence (no per-step prompts). Stop on the first failure; do not force.

1. `git worktree remove {worktreePath}` — only if a worktree was used.
2. `git branch -d {branch}` then `git push origin --delete {branch}`.
3. Clear `.muggle-ai/` session folders for this branch's runs and stale `/tmp/muggle-prepare-*.log` files. Cloud results stay.
4. Invoke `commit-commands:clean_gone` via the `Skill` tool.
