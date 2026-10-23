# Post-Merge Cleanup Stage

Invoked by `/muggle-do` when the watcher forwards a PR's terminal state. On `merged` it deletes the Muggle test cases the change retired, then resolves the session's workspace and **delegates** teardown to the shared procedure (it does not restate the teardown steps); on `closed` (unmerged) it skips teardown. Either way it ends by suggesting the next step. Never runs while the PR is open.

## Input

`$ARGUMENTS` carries `slug=<slug>` and `state=<merged|closed>` (default `merged`). No PR URL, no review ids.

## Procedure

1. Read `~/.muggle-ai/muggle-do/sessions/<slug>/`: `prs.json` (PR `repo`, `number`, observed `state`) and `state.md` (`worktreePath` if a worktree was used, and the target branch `headRefName`).
2. If `prs.json` shows the PR still open, do nothing and exit — this stage is terminal-only.
3. **Retire the cases the change replaced or removed (`merged` only).** Read the newest `e2eScope` recorded in the slot's `iterations/` ([`impact-analysis.md`](impact-analysis.md#output-state--e2escope)) — later cycles rescope, so the newest one describes what merged. Soft-delete each `retiredTestCases` entry with `muggle-remote-test-case-delete`, then each `retiredUseCases` entry with `muggle-remote-use-case-delete`, all in one message per kind. Before deleting a use case, confirm with `muggle-remote-test-case-list-by-use-case` that every test case under it is in the retired list: the delete cascades, so a test case added since scoping keeps the use case and its id is reported instead. An id already gone counts as deleted. On `closed` nothing is deleted — the change never landed, so the default branch still exercises those cases.
4. **Teardown (`merged` only).** When the PR is `merged`, run [`../_shared/post-merge-cleanup.md`](../_shared/post-merge-cleanup.md) with `{worktreePath}` and `{branch}`. That file owns the teardown sequence **and its safety rules** — including skipping worktree-remove and local branch deletion when no worktree was used. This stage adds no teardown logic of its own. On `closed`, skip teardown — the branch and any worktree stay intact.
5. Append a cleanup line to the session's `followup.log`, recording the case ids retired and whether teardown ran.
6. Suggest the next step per [`next-step.md`](next-step.md), passing whether teardown ran. This is the stage's last action.

**Teardown never returns a question, and neither does retirement.** Each finishes with its report — every item done, skipped, or blocked-with-a-reason — so steps 5 and 6 always run. A teardown that appears to be waiting on the user has stalled mid-sequence; the stage is not complete until the report and the next-step suggestion are both printed.
