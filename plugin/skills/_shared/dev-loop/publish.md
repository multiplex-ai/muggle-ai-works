# Dev Loop — Publish & Screenshots

## Publish

After every completed run — pass or fail — publish: failed runs still need cloud-hosted screenshots and per-step actions for the walkthrough, and the upload `status` tells the backend whether to promote the action script as the canonical replay script (pass → promote; fail → record only).

`muggle-local-publish-test-script` with `runId` and `cloudTestCaseId`. Retain `testScriptId`, `actionScriptId`, `viewUrl`. Batch publishes in parallel.

If publish rejects with `has no generated actionScript steps to publish` (a true zero-step run), fall back to `muggle-remote-local-run-upload` with whatever exists (`summaryStep`, `errorMessage`, empty `actionScript`); capture `actionScriptId` and `viewUrl` the same way.

## Screenshots

Per published script, `muggle-remote-test-script-get` with the `testScriptId` from publish → per step `operation.screenshotUrl` and `operation.action`. Retain `{ stepIndex, action, screenshotUrl }`. Batch in parallel. These feed the `E2eReport` consumed by [`../../muggle-pr-visual-walkthrough/SKILL.md`](../../muggle-pr-visual-walkthrough/SKILL.md) — the dev loop does not post to the PR.
