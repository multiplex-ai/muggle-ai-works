# Post-Merge Cleanup Stage

Invoked by `/muggle-do` when the watcher forwards a PR's terminal state. On `merged` it resolves the session's workspace and **delegates** teardown to the shared procedure (it does not restate the teardown steps); on `closed` (unmerged) it skips teardown. Either way it ends by suggesting the next step. Never runs while the PR is open.

## Input

`$ARGUMENTS` carries `slug=<slug>` and `state=<merged|closed>` (default `merged`). No PR URL, no review ids.

## Procedure

1. Read `~/.muggle-ai/muggle-do/sessions/<slug>/`: `prs.json` (PR `repo`, `number`, observed `state`) and `state.md` (`worktreePath` if a worktree was used, and the target branch `headRefName`).
2. If `prs.json` shows the PR still open, do nothing and exit — this stage is terminal-only.
3. **Teardown (`merged` only).** When the PR is `merged`, run [`../_shared/post-merge-cleanup.md`](../_shared/post-merge-cleanup.md) with `{worktreePath}` and `{branch}`. That file owns the teardown sequence **and its safety rules** — including skipping worktree-remove and local branch deletion when no worktree was used. This stage adds no teardown logic of its own. On `closed`, skip teardown — the branch and any worktree stay intact.
4. Append a cleanup line to the session's `followup.log`, recording whether teardown ran.
5. Suggest the next step per [`next-step.md`](next-step.md), passing whether teardown ran. This is the stage's last action.
