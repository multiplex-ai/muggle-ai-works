# `autoUseWorktree` gate

**Fire only when** the cwd is not already a worktree (`git rev-parse --is-inside-work-tree`) AND the work is more than a trivial edit. Otherwise skip.

On `always`: create the worktree via `superpowers:using-git-worktrees`. Worktree setup (env file, `npm install`, port, readiness) → [`muggle-test-prepare`](../muggle-test-prepare/SKILL.md).
