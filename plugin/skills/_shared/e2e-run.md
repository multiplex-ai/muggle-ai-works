# E2E Run Loop — Shared Reference

> Source of truth for the per-test-case local browser run loop — resolve script, execute, fetch result, publish, gather screenshots — and its invariants. Used by `muggle-test` (Step 7A local), `muggle-test-feature-local`, `muggle-do` Stage 6 ([`../do/e2e-acceptance.md`](../do/e2e-acceptance.md)), and the `acceptance-tester` agent. Callers link here rather than restate the loop.

Owned here: the loop mechanics and the invariants below. Not owned here — caller resolves and passes in: which test cases to run, replay-vs-regen classification and failure routing ([`failure-mode-handling.md`](failure-mode-handling.md)), dev-server readiness ([`dev-server-readiness.md`](dev-server-readiness.md)), validation context ([`resolve-e2e-validation-context.md`](resolve-e2e-validation-context.md)), and PR posting ([`../muggle-pr-visual-walkthrough/SKILL.md`](../muggle-pr-visual-walkthrough/SKILL.md)).

## Inputs

The caller resolves these before the loop and supplies them per test case:

- `mode` — `replay` or `regen`, already chosen (by the user, or by [`failure-mode-handling.md`](failure-mode-handling.md) for change-driven callers).
- `localUrl` — local execution target. Local-only; never changes the cloud project or test definitions.
- `cwd` — absolute path of the active working tree (PR-branch worktree if one exists, else repo root). Drives the cross-worktree single-flight lock so concurrent runs serialize.
- `testCase` / `cloudTestCaseId` — the cloud test case and its id.
- `showUi` — from the caller's `showElectronBrowser` resolution: omit for visible, `false` for headless.

The tool boundary is fixed: cloud reads (`muggle-remote-*`) resolve definitions and scripts; local tools (`muggle-local-*`) run Electron, fetch results, and publish.

## Action script

On the replay path use the `muggle-remote-action-script-get` response **as-is** — never edit, shorten, or rebuild `actionScript`; replay needs the full `label` paths for element lookup. For batches, fan the script fetches out in parallel before the sequential execute loop.

## Fresh session

Pass `freshSession: true` for a test case that needs clean browser state (no prior cookies, localStorage, or login):

- Registration / sign-up.
- Login / authentication when the flow itself is under test (not a test that merely *uses* login as a prerequisite).
- Cookie-consent / GDPR first-visit banners.
- Onboarding / first-run experiences.

Otherwise omit it (defaults `false`, preserving session state). Evaluate per test case — in a batch some need it and some don't.

## The loop

One local Electron browser exists, so **execution is sequential** — one test case at a time, in the caller's order. The pre/post fetches are independent across test cases and should be issued in parallel batches around the sequential execute calls.

Per test case, branch on `mode`:

**Replay**
1. `muggle-remote-test-script-get` (latest replayable script) → note `actionScriptId`.
2. `muggle-remote-action-script-get` with that id → full `actionScript` (see [Action script](#action-script)).
3. `muggle-local-execute-replay` with `testScript`, `actionScript`, `localUrl`, `cwd`, `showUi`, `freshSession`, `timeoutMs` (see [Timeouts](#timeouts)).

**Regen**
1. `muggle-remote-test-case-get` → full test case object.
2. `muggle-local-execute-test-generation` with `testCase`, `localUrl`, `cwd`, `showUi`, `freshSession`, `timeoutMs` (see [Timeouts](#timeouts)).

Store the returned `runId`, tagged with its `mode`. If a run fails, log it and continue the batch — never abort. Route failures afterward via [`failure-mode-handling.md`](failure-mode-handling.md).

## Timeouts

The MCP client default wait is **300000 ms (5 min)**. Exploratory generation (identity login, multi-step flows, many LLM iterations) routinely runs longer while Electron is still healthy.

- **Always pass `timeoutMs`** — `600000` (10 min) or `900000` (15 min) — unless the test case is known simple or the user wants a short cap.
- `Electron execution timed out after 300000ms` while logs show the run still progressing (steps, screenshots, LLM calls) is an **orchestration timeout, not an Electron defect** — increase `timeoutMs` and retry.

## Failure interpretation

Read **structured fields** from `muggle-local-run-result-get`, never `execute`'s stdout tail (a truncated display excerpt). Order: `Status` → `Error` → `Artifacts`.

- The `Artifacts` section is present after any completed run; it names `artifactsDir` and lists files. On pass, `results.md` is the step-by-step verdict (read it before summarizing). On failure, `stdout.log` + `stderr.log` are always present; `action-script.json` appears when generation reached step-emission (typical for `goal_not_achievable`); `results.md` and per-step screenshots are absent on the failure path — don't hunt for them.
- `Electron execution timed out after 300000ms` → orchestration wait too short; see [Timeouts](#timeouts).
- **Exit code 26** (with "LLM failed to generate / replay action script") is usually a completed exploration whose outcome was **goal not achievable** (`goal_not_achievable`, summary with `halt`) — e.g. asserting "view a completed run" on an account that has none. Read the summary; don't assume a crash. Fix the precondition: pick a project/account that already has the needed state, or narrow the goal so generation isn't forced to create resources from scratch.

Then route via [`failure-mode-handling.md`](failure-mode-handling.md).

## Run result

For each `runId`, `muggle-local-run-result-get` → extract `Status`, `Error`, `Duration`, and `Artifacts` (`artifactsDir` + file list). Retain per test case: `testCaseId`, `testScriptId` (if any), `runId`, `status`, `artifactsDir`.

## Publish

After every completed run — pass or fail — publish: failed runs still need cloud-hosted screenshots and per-step actions for the walkthrough, and the upload `status` tells the backend whether to promote the action script as the canonical replay script (pass → promote; fail → record only).

`muggle-local-publish-test-script` with `runId` and `cloudTestCaseId`. Retain `testScriptId`, `actionScriptId`, `viewUrl`. Batch publishes in parallel.

If publish rejects with `has no generated actionScript steps to publish` (a true zero-step run), fall back to `muggle-remote-local-run-upload` with whatever exists (`summaryStep`, `errorMessage`, empty `actionScript`); capture `actionScriptId` and `viewUrl` the same way.

## Screenshots

Per published script, `muggle-remote-test-script-get` with the `testScriptId` from publish → per step `operation.screenshotUrl` and `operation.action`. Retain `{ stepIndex, action, screenshotUrl }`. Batch in parallel. These feed the `E2eReport` consumed by [`../muggle-pr-visual-walkthrough/SKILL.md`](../muggle-pr-visual-walkthrough/SKILL.md) — this doc does not post to the PR.
