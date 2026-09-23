# Dev Loop — Reading the Result

For each `runId`, call `muggle-local-run-result-get` and read **structured fields**, never `execute`'s stdout tail (a truncated display excerpt). Order: `Status` → `Error` → `Artifacts`. Retain per test case: `testCaseId`, `testScriptId` (if any), `runId`, `status`, `artifactsDir`.

## Artifacts

The `Artifacts` section is present after any completed run; it names `artifactsDir` and lists files. On pass, `results.md` is the step-by-step verdict (read it before summarizing). On failure, `stdout.log` + `stderr.log` are always present; `action-script.json` appears when generation reached step-emission (typical for `goal_not_achievable`); `results.md` is absent.

Per-step frames are **not** absent on the failure path — the `Artifacts` section just doesn't list them. A failed run writes them under `artifactsDir` like any other, so a run that halted still has a frame for every step it took. Call `muggle-local-run-steps-get` with the `runId` to get the steps paired with those frames rather than walking the directory.

## Common failures

- `Electron execution timed out after 300000ms` → orchestration wait too short; see [`timeouts.md`](timeouts.md).
- **Exit code 26** (with "LLM failed to generate / replay action script") is usually a completed exploration whose outcome was **goal not achievable** (`goal_not_achievable`, summary with `halt`) — e.g. asserting "view a completed run" on an account that has none. Read the summary; don't assume a crash. Fix the precondition: pick a project/account that already has the needed state, or narrow the goal so generation isn't forced to create resources from scratch.

Then route via [`../failure-mode-handling.md`](../failure-mode-handling.md).
