# Use a Worktree for the Change

Gated by [`autoUseWorktree`](../muggle-preferences/preference-gates/autoUseWorktree.md). Follow the standard procedure in [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md).

**Fire only when** the current checkout is not already a worktree (`git rev-parse --is-inside-work-tree`, inspect `git worktree list`) **and** the work is more than a trivial edit. Otherwise skip — no picker, no footer.

On `always`, defer worktree creation to `superpowers:using-git-worktrees`. After the worktree exists, the dev-server side (env-file copy, per-worktree `npm install`, port readiness, cleanup) is owned by [`../muggle-test-prepare/SKILL.md`](../muggle-test-prepare/SKILL.md) — call into it rather than duplicating the rules.
