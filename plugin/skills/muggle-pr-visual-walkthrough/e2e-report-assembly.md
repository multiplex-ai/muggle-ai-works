# E2eReport Assembly Guide

Include **all** runs — passed and failed. Never drop a run.

## From `muggle-test` / `muggle-test-feature-local` (local mode)

### Published run (returned by `muggle-local-publish-test-script`)

Issue all `muggle-remote-test-script-get` calls in parallel — one per `testScriptId`. For each response:

1. Build `steps[]`: `[{ stepIndex: <index>, action: steps[i].operation.action, screenshotUrl: steps[i].operation.screenshotUrl }, ...]`
2. `viewUrl` — from publish response.
3. `status` — from `muggle-local-run-result-get`.
4. If failed: also capture `failureStepIndex`, `error`, `artifactsDir` from the run result.

### Failed/unpublished run (timeout, `goal_not_achievable`, or any run never passed to `muggle-local-publish-test-script`)

1. `steps: []` — no cloud screenshots available.
2. `viewUrl`: `https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/runs`
3. `status: "failed"`, `failureStepIndex: 0`, `error` from run result.
4. `testCaseId` — from execution step selection. `runId` — from `muggle-local-execute-test-generation` (always present even on failure).

### Metadata (every entry)

- `description` — test case title/description. Drives the collapsible header. Prefer context; call `muggle-remote-test-case-get` only if missing.
- `useCaseName` — parent use case title. When present on any entry, the overview groups by use case. Prefer context; call `muggle-remote-use-case-get` only if missing.

### Shape

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

## From `muggle-do` (`open-prs.md`)

`e2e-acceptance.md` already produces this shape — pass it through unchanged.

## Direct invocation (user asked to post existing results)

The caller must have already executed tests and published them. If the `E2eReport` is not in context, stop and tell the user to run `muggle-test` or `muggle-test-feature-local` first.
