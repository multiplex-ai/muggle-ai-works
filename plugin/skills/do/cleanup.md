# Post-Merge Cleanup Stage

Invoked by `/muggle-do` when the watcher's terminal tick hands off cleanup after a PR merges. Tears down the merged change's worktree, branch, and local artifacts. Gated by `autoCleanup`; never runs while the PR is open.

## Input

`$ARGUMENTS` carries the session slug as `slug=<slug>`. No PR URL, no review ids.

## Procedure

1. Read the session slot `~/.muggle-ai/muggle-do/sessions/<slug>/`:
   - `prs.json` — the PR's `repo`, `number`, and observed `state`.
   - `state.md` — `worktreePath` (present only if a worktree was used) and the target branch (`headRefName`).
2. Confirm `prs.json` shows the PR `merged`. If it is still open or was closed unmerged, do nothing and exit — this stage is post-merge only.
3. Run [`../_shared/post-merge-cleanup.md`](../_shared/post-merge-cleanup.md), substituting `{worktreePath}` and `{branch}`. It honors the `autoCleanup` gate (`always` runs the full sequence, `ask` confirms first, `never` skips).
4. **Worktree-aware safety.** When no `worktreePath` was recorded — a bootstrap or auto-track session running in the user's own checkout — skip the worktree-remove and local `git branch -d` steps: the user is on that branch in their live checkout, and deleting it would disrupt their workspace. Limit cleanup to the remote-branch delete and artifact prune.
5. Append a cleanup line to the session's `followup.log`.
