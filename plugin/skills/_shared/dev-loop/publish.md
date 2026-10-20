# Dev Loop — Cloud Refs & Screenshots

## Cloud refs

The studio publishes every completed run — pass or fail — to the cloud during execution. There is no publish step to run. The run result already carries the cloud identifiers: read `viewUrl`, `cloudTestScriptId`, and `cloudActionScriptId` from `muggle-local-run-result-get` for the run. (`cloudTestScriptId` is absent for a failed generation — the backend records the action script and `viewUrl` but no test script.)

## Screenshots

Per run, `muggle-remote-test-script-get` with the `cloudTestScriptId` from the run result → per step `operation.screenshotUrl`, `operation.action` and `briefExplanation`. Retain `{ stepIndex, action, description, screenshotUrl, afterScreenshotUrl }`, with `description` taken from `briefExplanation` — `action` is only the operation verb, and the description is what the walkthrough shows a reviewer. `afterScreenshotUrl` is the page after the step acted: the next step's `operation.screenshotUrl` among steps that have one, and for the last such step the `summaryStep.operation.screenshotUrl` (rule and skipped operations in [`../../muggle-pr-visual-walkthrough/e2e-report-assembly.md`](../../muggle-pr-visual-walkthrough/e2e-report-assembly.md)). When `cloudTestScriptId` is absent — every failed generation, per above — call `muggle-remote-action-script-get` with `cloudActionScriptId` instead; it returns the same `steps[]` shape, so a non-passing run keeps its per-step screenshots rather than collapsing to a single ending frame. Batch in parallel. These feed the `E2eReport` consumed by [`../../muggle-pr-visual-walkthrough/SKILL.md`](../../muggle-pr-visual-walkthrough/SKILL.md) — the dev loop does not post to the PR.
