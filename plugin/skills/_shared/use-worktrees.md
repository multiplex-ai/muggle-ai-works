# Use a Worktree for the Change

When the user is about to start meaningful development or write-up work (more than a quick edit), recommend creating a git worktree so the current checkout stays untouched.

This is a **recommendation**, not a requirement — surface it via `AskUserQuestion` and let the user opt out. Never run destructive git commands without confirmation.

- **Surface it as a choice**, not a requirement, via `AskUserQuestion`:
  - "Create a worktree for this change (recommended)"
  - "Work directly in the current checkout"
- **Skip the prompt** if the work is trivial (typo fix, one-line config tweak) or the user has already opted out in this session.
- **How to create** — see the `superpowers:using-git-worktrees` skill. Don't reinvent the workflow here.
