# E2eReport Assembly Guide

Include **all** runs — passed and failed. Never drop a run.

## Published run (passed or failed — anything with action steps)

Most runs end up here, including failures. Any run with at least one action step should be uploaded via `muggle-local-publish-test-script` — pass-or-fail. The `status: "failed"` payload tells the backend to record the run without promoting its action script as the test case's canonical replay script, so screenshots become cloud-accessible without clobbering a previously working script.

Issue all `muggle-remote-test-script-get` calls in parallel — one per `testScriptId`. For each response:

1. Build `steps[]`: `[{ stepIndex: <index>, action: steps[i].operation.action, screenshotUrl: steps[i].operation.screenshotUrl }, ...]`
2. `viewUrl` — from publish response.
3. `status` — from `muggle-local-run-result-get`.
4. If failed: also capture `failureStepIndex`, `error`, `artifactsDir` from the run result.

## True unpublishable (no steps recorded)

Reserved for runs Electron rejected before producing any action — orchestration timeout before launch, hard crash, `goal_not_achievable` halt at step 0. Recognizable because `muggle-local-publish-test-script` rejects with `has no generated actionScript steps to publish`.

1. `steps: []` — nothing to render.
2. `viewUrl`: `https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/runs`
3. `status: "failed"`, `failureStepIndex: 0`, `error` from run result.
4. `testCaseId` — from execution step selection. `runId` — from `muggle-local-execute-test-generation` (always present even on failure).

On every entry: `description` (test case title/description — drives the collapsible header) and `useCaseName` (parent use case title — when present, the overview groups by use case) are optional but recommended. Prefer values already in context; only call `muggle-remote-test-case-get` / `muggle-remote-use-case-get` if missing.

If called from `muggle-do`: `e2e-acceptance.md` already produces this shape — pass it through unchanged.

## Shape

```json
{
  "projectId": "<projectId>",
  "tests": [
    {
      "name": "<test case title>",
      "description": "<one-line description (recommended)>",
      "useCaseName": "<parent use case title (recommended)>",
      "testCaseId": "<testCaseId from execution step>",
      "testScriptId": "<testScriptId from publish>",
      "runId": "<runId from muggle-local-execute-test-generation>",
      "viewUrl": "<viewUrl from publish>",
      "status": "passed",
      "steps": [{ "stepIndex": 0, "action": "...", "screenshotUrl": "..." }]
    },
    {
      "name": "<failed test case title>",
      "description": "<one-line description (recommended)>",
      "useCaseName": "<parent use case title (recommended)>",
      "testCaseId": "<testCaseId from execution step>",
      "runId": "<runId from muggle-local-execute-test-generation>",
      "viewUrl": "https://www.muggle-ai.com/muggleTestV0/dashboard/projects/<projectId>/runs",
      "status": "failed",
      "steps": [],
      "failureStepIndex": 0,
      "error": "<error message from run result>"
    }
  ]
}
```
