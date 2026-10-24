# Post-Merge Cleanup Stage

Invoked by `/muggle-do` when the watcher forwards a PR's terminal state. On `merged` it deletes the Muggle test cases the change retired, then resolves the session's workspace and **delegates** teardown to the shared procedure (it does not restate the teardown steps); on `closed` (unmerged) it skips teardown. Either way it ends by suggesting the next step. Never runs while the PR is open.

## Input

`$ARGUMENTS` carries `slug=<slug>` and `state=<merged|closed>` (default `merged`). No PR URL, no review ids.

## Terminal record

The facts [`next-step.md`](next-step.md) reports a finished PR from. Teardown deletes the slot, so step 4 captures them first; step 6 adds the teardown outcome:

- `pr` — `<owner>/<repo>#<n>` and URL, from `prs.json`.
- `state` — `merged` or `closed`, from `prs.json`.
- `title` — from the PR-metadata recipe of `prs.json`'s `provider` ([`github.md`](../_shared/vcs/github.md), [`gitlab.md`](../_shared/vcs/gitlab.md)); the slot does not store it.
- `e2eFailing` — the title carries `[E2E FAILING]`: the PR shipped on a waived E2E verdict.
- `escalatedReviewIds` — `result.md`'s `Escalated review ids`; empty on `none` or when `result.md` is absent.
- `waivers` — `state.md`'s waiver and Blocker lines, verbatim.
- `teardown` — the note next-step prints, from this turn's teardown report: `cleaned up` when no row is `❌`, the first `❌` row's reason otherwise, `branch kept` when teardown did not run.
- `finishedAt` — ISO-8601, when step 6 ran.

## Chat ledger

`~/.muggle-ai/muggle-do/chats/<session-id>.json` — a JSON array of the terminal record of every PR this chat finished. It sits outside the sessions directory, so teardown never deletes it, and [`next-step.md`](next-step.md) reads it to report PRs whose slots are gone. `<session-id>` is `$CLAUDE_CODE_SESSION_ID`; unset, the chat cannot name its ledger and none is written. Rewrite the whole file per [`session-state-writes.md`](../_shared/session-state-writes.md); a record whose `pr` is already listed replaces that entry.

## Procedure

1. Read `~/.muggle-ai/muggle-do/sessions/<slug>/`: `prs.json` (PR `repo`, `number`, observed `state`) and `state.md` (`worktreePath` if a worktree was used, and the target branch `headRefName`).
2. If `prs.json` shows the PR still open, do nothing and exit — this stage is terminal-only.
3. **Retire the cases the change replaced or removed (`merged` only).** Read the newest `e2eScope` recorded in the slot's `iterations/` ([`impact-analysis.md`](impact-analysis.md#output-state--e2escope)) — later cycles rescope, so the newest one describes what merged. Soft-delete each `retiredTestCases` entry with `muggle-remote-test-case-delete`, then each `retiredUseCases` entry with `muggle-remote-use-case-delete`, all in one message per kind. Before deleting a use case, confirm with `muggle-remote-test-case-list-by-use-case` that every test case under it is in the retired list: the delete cascades, so a test case added since scoping keeps the use case and its id is reported instead. An id already gone counts as deleted. On `closed` nothing is deleted — the change never landed, so the default branch still exercises those cases.
4. **Capture the [terminal record](#terminal-record)** from the slot and the provider. This is the last read of `<slug>`'s slot: teardown may delete it next.
5. **Teardown (`merged` only).** When the PR is `merged`, run [`../_shared/post-merge-cleanup.md`](../_shared/post-merge-cleanup.md) with `{worktreePath}` and `{branch}`. That file owns the teardown sequence **and its safety rules** — including skipping worktree-remove and local branch deletion when no worktree was used. This stage adds no teardown logic of its own. On `closed`, skip teardown — the branch and any worktree stay intact.
6. **Record the PR in the [chat ledger](#chat-ledger).** Complete the terminal record with `teardown` and `finishedAt`, then write it to the ledger. The ledger is outside the slot, so this holds whether or not teardown cleared it.
7. **Log while the slot exists.** When teardown's report marks `Session slot cleared` ✅, write nothing: the slot and its `followup.log` are gone, an append there fails or recreates the directory as a stray slot, and the retirement and teardown reports printed this turn are the record. Otherwise append a cleanup line to the session's `followup.log`, recording the case ids retired and whether teardown ran.
8. Suggest the next step per [`next-step.md`](next-step.md), passing whether teardown ran and the terminal record. This is the stage's last action.

**Teardown never returns a question, and neither does retirement.** Each finishes with its report — every item done, skipped, or blocked-with-a-reason — so steps 6, 7 and 8 always run. A teardown that appears to be waiting on the user has stalled mid-sequence; the stage is not complete until the report and the next-step suggestion are both printed.
