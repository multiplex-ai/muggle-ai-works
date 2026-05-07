# E2eReport Assembly Guide

This is the **single source of truth** for building the `E2eReport` JSON required by `muggle-pr-visual-walkthrough`. Load this file when assembling the report.

## From `muggle-test` / `muggle-test-feature-local` (local mode)

**Include ALL runs — passed and failed.** Never drop a run from the report. Reviewers need the full picture.

### For each published run (returned by `muggle-local-publish-test-script`)

Issue all `muggle-remote-test-script-get` calls in parallel — one per `testScriptId`. For each response:

1. Extract `steps[]`: build `[{ stepIndex: <index>, action: steps[i].operation.action, screenshotUrl: steps[i].operation.screenshotUrl }, ...]`.
2. Use the `viewUrl` returned by `muggle-local-publish-test-script`.
3. Set `status` from the local run result (`muggle-local-run-result-get`).
4. For a published-but-failed run, also capture `failureStepIndex`, `error`, and `artifactsDir` from the run result.

### For each failed/unpublished run (timeout, `goal_not_achievable`, or any run never passed to `muggle-local-publish-test-script`)

1. Set `steps: []` — no cloud screenshots available.
2. Set `viewUrl` to the project runs page: `https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/runs`
3. Set `status: "failed"`, `failureStepIndex: 0`, and `error` from the run result.
4. `testCaseId` comes from the test case selected in the execution step. `runId` comes from the `runId` returned by `muggle-local-execute-test-generation` — it is always present even when the execution failed.

### Populate metadata on every entry

- `description` — the test case's title/description. Drives the collapsible header.
- `useCaseName` — the parent use case title. When present on any entry, the overview groups by use case.

Prefer values already in context; only call `muggle-remote-test-case-get` / `muggle-remote-use-case-get` for anything not already known.

### Assembled E2eReport shape

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
      "description": "<description>",
      "useCaseName": "<use case title>",
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

The `e2e-acceptance.md` stage already produces an `E2eReport` with the exact shape above — pass it through unchanged.

## Direct invocation (user asked to post existing results)

The caller must have already executed tests and published them. If the `E2eReport` is not in context, stop and tell the user to run `muggle-test` or `muggle-test-feature-local` first.
