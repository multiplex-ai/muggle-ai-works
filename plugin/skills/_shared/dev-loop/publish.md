# Dev Loop — Cloud Refs & Screenshots

## Cloud refs

The studio publishes every completed run — pass or fail — to the cloud during execution. There is no publish step to run. The run result already carries the cloud identifiers: read `viewUrl`, `cloudTestScriptId`, and `cloudActionScriptId` from `muggle-local-run-result-get` for the run. (`cloudTestScriptId` is absent for a failed generation — the backend records the action script and `viewUrl` but no test script.)

## Screenshots

Per run, `muggle-remote-test-script-get` with the `cloudTestScriptId` from the run result → per step `operation.screenshotUrl` and `operation.action`. Retain `{ stepIndex, action, screenshotUrl }`. Batch in parallel. These feed the `E2eReport` consumed by [`../../muggle-pr-visual-walkthrough/SKILL.md`](../../muggle-pr-visual-walkthrough/SKILL.md) — the dev loop does not post to the PR.
