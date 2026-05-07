# E2eReport Assembly Guide

Include **all** runs — passed and failed. Never drop a run.

## Published run (returned by `muggle-local-publish-test-script`)

Issue all `muggle-remote-test-script-get` calls in parallel — one per `testScriptId`:

1. Build `steps[]`: `[{ stepIndex, action: steps[i].operation.action, screenshotUrl: steps[i].operation.screenshotUrl }, ...]`
2. `viewUrl` — from publish response.
3. `status` — from `muggle-local-run-result-get`.
4. If failed: also capture `failureStepIndex`, `error`, `artifactsDir` from the run result.

## Failed/unpublished run (timeout, `goal_not_achievable`, never published)

1. `steps: []`
2. `viewUrl`: `https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/runs`
3. `status: "failed"`, `failureStepIndex: 0`, `error` from run result.
4. `testCaseId` — from execution step selection. `runId` — from `muggle-local-execute-test-generation` (always present even on failure).

## Metadata (every entry)

- `description` — test case title/description. Prefer context; call `muggle-remote-test-case-get` only if missing.
- `useCaseName` — parent use case title. Prefer context; call `muggle-remote-use-case-get` only if missing.

## Shape

```json
{
  "projectId": "<projectId>",
  "tests": [
    {
      "name": "<title>",
      "description": "<one-line description>",
      "useCaseName": "<use case title>",
      "testCaseId": "<testCaseId from execution step>",
      "testScriptId": "<testScriptId from publish>",
      "runId": "<runId from muggle-local-execute-test-generation>",
      "viewUrl": "<viewUrl from publish>",
      "status": "passed",
      "steps": [{ "stepIndex": 0, "action": "...", "screenshotUrl": "..." }]
    },
    {
      "name": "<title>",
      "description": "<one-line description>",
      "useCaseName": "<use case title>",
      "testCaseId": "<testCaseId from execution step>",
      "runId": "<runId from muggle-local-execute-test-generation>",
      "viewUrl": "https://www.muggle-ai.com/muggleTestV0/dashboard/projects/<projectId>/runs",
      "status": "failed",
      "steps": [],
      "failureStepIndex": 0,
      "error": "<error from run result>"
    }
  ]
}
```

## From `muggle-do`

`e2e-acceptance.md` already produces this shape — pass it through unchanged.
