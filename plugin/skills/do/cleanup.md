# Post-Merge Cleanup Stage

Invoked by `/muggle-do` when the watcher forwards a PR's terminal (`merged`) state. This stage only resolves the session's workspace and **delegates** teardown to the shared procedure — it does not restate the teardown steps. Never runs while the PR is open.

## Input

`$ARGUMENTS` carries the session slug as `slug=<slug>`. No PR URL, no review ids.

## Procedure

1. Read `~/.muggle-ai/muggle-do/sessions/<slug>/`: `prs.json` (PR `repo`, `number`, observed `state`) and `state.md` (`worktreePath` if a worktree was used, and the target branch `headRefName`).
2. Confirm `prs.json` shows the PR `merged`. If it is still open or was closed unmerged, do nothing and exit — this stage is post-merge only.
3. Run [`../_shared/post-merge-cleanup.md`](../_shared/post-merge-cleanup.md) with `{worktreePath}` and `{branch}`. That file owns the teardown sequence **and its safety rules** — including skipping worktree-remove and local branch deletion when no worktree was used. This stage adds no teardown logic of its own.
4. Append a cleanup line to the session's `followup.log`.
