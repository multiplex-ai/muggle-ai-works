# Dev Loop — Run a Test

> The local dev loop: run one test case in the browser (replay an existing script, or regenerate from the case), then record the result. Source of truth for the run mechanics; the sibling files in this folder own each invariant.

Not owned here — the caller resolves and passes in: which test cases to run, replay-vs-regen classification and failure routing ([`../failure-mode-handling.md`](../failure-mode-handling.md)), dev-server readiness ([`../dev-server-readiness.md`](../dev-server-readiness.md)), validation context ([`../resolve-e2e-validation-context.md`](../resolve-e2e-validation-context.md)), and PR posting ([`../../muggle-pr-visual-walkthrough/SKILL.md`](../../muggle-pr-visual-walkthrough/SKILL.md)).

## Inputs

The caller resolves these before the loop and supplies them per test case:

- `mode` — `replay` or `regen`, already chosen (by the user, or by [`../failure-mode-handling.md`](../failure-mode-handling.md) for change-driven callers).
- `localUrl` — local execution target. Local-only; never changes the cloud project or test definitions.
- `cwd` — absolute path of the active working tree (PR-branch worktree if one exists, else repo root). Keys the cross-worktree execution lane so concurrent runs from different checkouts take turns at the one local browser, and names the checkout the execute tools check for freshness.
- `baseBranch` — the change's base, only when it is not the remote default (a stacked change, a PR into a release branch). Omitted, the tools check `cwd` against the remote default.
- `testCase` / `cloudTestCaseId` — the cloud test case and its id.
- `showUi` — from the caller's `showElectronBrowser` resolution: omit for visible, `false` for headless.

The tool boundary is fixed: cloud reads (`muggle-remote-*`) resolve definitions and scripts; local tools (`muggle-local-*`) run the browser, fetch results, and publish.

## Sequence

One local browser exists, so **execution is sequential** — one test case at a time, in the caller's order. The pre/post fetches are independent across test cases and should be issued in parallel batches around the sequential execute calls.

Per test case, branch on `mode`:

**Replay**
1. `muggle-remote-test-script-get` (latest replayable script — the lane-scoped one the caller resolved during classification per [`../failure-mode-handling.md`](../failure-mode-handling.md) §A) → note `actionScriptId`.
2. `muggle-remote-action-script-get` with that id → full `actionScript` (see [`action-script.md`](action-script.md)), plus the `pinnedAccount` and `freshSession` its `actionParams` recorded.
3. `muggle-local-execute-replay` with `testScript`, `actionScript`, `localUrl`, `cwd`, `showUi`, `pinnedAccount` and `freshSession` (each copied from the recording's `actionParams` when present; see [`fresh-session.md`](fresh-session.md)), `timeoutMs` (see [`timeouts.md`](timeouts.md)).

**Regen**
1. `muggle-remote-test-case-get` → full test case object.
2. `muggle-local-execute-test-generation` with `testCase`, `localUrl`, `cwd`, `showUi`, `freshSession` (omit it so the stored flag decides; pass it only to override for this run, per [`fresh-session.md`](fresh-session.md)), `timeoutMs`.

Store the returned `runId`, tagged with its `mode`. If a run fails, log it and continue the batch — never abort. Read the result per [`failures.md`](failures.md), then [`publish.md`](publish.md).

**A refused run is not a failure.** A result headed `Run refused — checkout is not on the latest …` launched nothing and has no `runId`: the `cwd` checkout lacks its base's latest commit (`BEHIND_BASE`) or carries another branch's commits (`FOREIGN_BASE`). Sync it per [`../sync-branch-with-base.md`](../sync-branch-with-base.md), re-invoke [`muggle-test-prepare`](../../muggle-test-prepare/SKILL.md) so the dev server serves the synced code, and run the case again. Never route it through failure handling or count it as a result.

**A busy lane is not a failure either.** A result headed `Lane busy — another checkout's run holds the local browser` launched nothing and has no `runId`: a peer session's run from a different checkout holds the one local browser. Each execute call waits up to `laneWaitSeconds` (default 20) and then answers at once with the holder, how long it has run, and this checkout's place in line — kept for as long as the checkout keeps asking. Don't idle: issue the next test case's independent cloud fetches or other work, then call the same execute tool again after the suggested delay; when nothing else is left, re-call it with a longer `laneWaitSeconds` to wait in the call. `muggle-local-execution-lane-status` shows the lane without taking a place. Never kill a peer's run to free the lane, never test against a peer's dev server instead, and never count a busy answer as a result.
