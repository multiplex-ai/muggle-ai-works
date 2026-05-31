# PR-Branch Worktree — Shared Reference

> Source of truth for materializing a PR's branch in an isolated worktree so the user's main checkout is never disturbed. Used by `muggle-test` (and any future skill that takes a GitHub PR URL). Skills MUST link here rather than restate the steps.

## When this applies

A skill receives a GitHub PR URL of the form `github.com/<org>/<repo>/pull/<n>` and needs the PR's branch checked out to test against it locally. For worktree principles (one-per-branch, port/data isolation, teardown) see [`use-worktrees.md`](use-worktrees.md) — this file owns only the materialize-an-existing-PR-branch operation.

## Steps

1. **Resolve the PR's head branch:**
   `gh pr view <n> --repo <org>/<repo> --json headRefName -q .headRefName`
2. **Sanitize the branch name** for filesystem use — replace `/` and other path separators with `-`. Example: `claude/regen-test-replay-flow-ZSScQ` → `claude-regen-test-replay-flow-ZSScQ`.
3. **Build the target worktree path:** `<repo>/.claude/worktrees/<sanitized-branch>`.
4. **Materialize the worktree:**
   - If the target path does NOT exist:
     - `git -C <repo> fetch origin <branch>`
     - `git -C <repo> worktree add <target-path> <branch>`
   - If the target path EXISTS (reused from a prior run):
     - `git -C <target-path> fetch`
     - `git -C <target-path> reset --hard origin/<branch>` — picks up new pushes, drops any local cruft.
5. **Use the worktree path as the working directory** for the rest of the run, including:
   - Passing it as the **`cwd` parameter** to `muggle-local-execute-test-generation` and `muggle-local-execute-replay`. This is required, not optional — see `_shared/failure-mode-handling.md` and the lock identity discussion in those tools' MCP source.
   - Resolving any `npm install` / dev-server start commands inside the worktree (it has its own `node_modules/` and `.env*` files).
6. **Tell the user** where the worktree lives so they can clean it up later with `git -C <repo> worktree remove <target-path>`.

## Invariants

- **Never switch the user's main checkout.** The whole point of this flow is isolation; `git checkout <branch>` on the main checkout is forbidden.
- **Never share `node_modules/` via symlink** across worktrees. Each worktree runs its own `npm install` (or `pnpm install`) — webpack's `resolve.symlinks: true` rewrites paths and breaks asset-identity tracking.
- **`.env*` files do not propagate.** A freshly created worktree has no env files unless the repo commits them. If the parent skill's dev server fails to boot, check whether `.env.local` (or framework equivalent) needs to be copied from the main checkout before launching.
