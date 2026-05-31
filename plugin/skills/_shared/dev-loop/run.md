# Dev Loop — Run a Test

> The local dev loop: run one test case in the browser (replay an existing script, or regenerate from the case), then record the result. Source of truth for the run mechanics; the sibling files in this folder own each invariant. Used by `muggle-test`, `muggle-test-feature-local`, `muggle-do` Stage 6 ([`../../do/e2e-acceptance.md`](../../do/e2e-acceptance.md)), and the `acceptance-tester` agent.

Not owned here — the caller resolves and passes in: which test cases to run, replay-vs-regen classification and failure routing ([`../failure-mode-handling.md`](../failure-mode-handling.md)), dev-server readiness ([`../dev-server-readiness.md`](../dev-server-readiness.md)), validation context ([`../resolve-e2e-validation-context.md`](../resolve-e2e-validation-context.md)), and PR posting ([`../../muggle-pr-visual-walkthrough/SKILL.md`](../../muggle-pr-visual-walkthrough/SKILL.md)).

## Inputs

The caller resolves these before the loop and supplies them per test case:

- `mode` — `replay` or `regen`, already chosen (by the user, or by [`../failure-mode-handling.md`](../failure-mode-handling.md) for change-driven callers).
- `localUrl` — local execution target. Local-only; never changes the cloud project or test definitions.
- `cwd` — absolute path of the active working tree (PR-branch worktree if one exists, else repo root). Drives the cross-worktree single-flight lock so concurrent runs serialize.
- `testCase` / `cloudTestCaseId` — the cloud test case and its id.
- `showUi` — from the caller's `showElectronBrowser` resolution: omit for visible, `false` for headless.

The tool boundary is fixed: cloud reads (`muggle-remote-*`) resolve definitions and scripts; local tools (`muggle-local-*`) run the browser, fetch results, and publish.

## Sequence

One local browser exists, so **execution is sequential** — one test case at a time, in the caller's order. The pre/post fetches are independent across test cases and should be issued in parallel batches around the sequential execute calls.

Per test case, branch on `mode`:

**Replay**
1. `muggle-remote-test-script-get` (latest replayable script) → note `actionScriptId`.
2. `muggle-remote-action-script-get` with that id → full `actionScript` (see [`action-script.md`](action-script.md)).
3. `muggle-local-execute-replay` with `testScript`, `actionScript`, `localUrl`, `cwd`, `showUi`, `freshSession` (see [`fresh-session.md`](fresh-session.md)), `timeoutMs` (see [`timeouts.md`](timeouts.md)).

**Regen**
1. `muggle-remote-test-case-get` → full test case object.
2. `muggle-local-execute-test-generation` with `testCase`, `localUrl`, `cwd`, `showUi`, `freshSession`, `timeoutMs`.

Store the returned `runId`, tagged with its `mode`. If a run fails, log it and continue the batch — never abort. Read the result per [`failures.md`](failures.md), then [`publish.md`](publish.md).
