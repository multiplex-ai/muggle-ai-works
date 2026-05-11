# E2eReport Assembly Guide

Include **all** runs — passed, failed, **and inconclusive**. Never drop a run. Always best-effort to upload so the dashboard has a record reviewers can open from the PR — even when the local run produced zero action steps.

## Picking a status

| Status | Use when | Required extras |
|---|---|---|
| `passed` | Run completed and the assertion held. | — |
| `failed` | Run completed and the assertion failed, or the product itself broke before the assertion could be made (server error, 500, broken page). | `failureStepIndex`, `error` |
| `inconclusive` | Run could not yield a pass/fail signal for reasons **outside the product**: no replayable script existed, environment precondition unmet, infra/Electron error, agent stalled on a cookie banner or login wall, missing secrets, agent went off-course. | `reason` (one short sentence; `steps[]` may be empty) |

If a test should be inconclusive but you don't have a real `runId` / `viewUrl` (e.g., generation never ran), use the same project-level dashboard fallback as the "last-resort" failed branch below: emit a stub run via `muggle-remote-local-run-upload` if at all possible; otherwise synthesize a UUID-shaped runId and use `https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/runs` as `viewUrl`. The schema requires both fields — but a working dashboard link is better than nothing.

## Uploaded run (passed or failed; the common path)

Every run that completed locally — pass or fail, with or without action steps — should reach the cloud via Step 8 of the caller skill. The upload response carries `actionScriptId` and `viewUrl`; `testScriptId` is **only present for passing runs and replays** (failed generations skip the test script wrapper to avoid clobbering the canonical replay target).

Fetch step screenshots in parallel — pick the right tool per upload:

- **`testScriptId` present** → `muggle-remote-test-script-get` with that id.
- **`testScriptId` missing** (failed generation, or zero-step fallback via `muggle-remote-local-run-upload`) → `muggle-remote-action-script-get` with `actionScriptId` from the upload response. Same `steps[]` + `summaryStep` shape; just one less hop.

For each result:

1. Build `steps[]`: `[{ stepIndex: <index>, action: steps[i].operation.action, screenshotUrl: steps[i].operation.screenshotUrl }, ...]`. Empty array is fine — zero-step runs still render the failure summary header in the walkthrough.
2. `viewUrl` — from upload response (deep-links to the specific run via `actionScriptId`).
3. `status` — from `muggle-local-run-result-get`.
4. If failed: also capture `failureStepIndex`, `error`, `artifactsDir` from the run result.

## Last-resort: upload genuinely failed

Reach this branch only when **both** `muggle-local-publish-test-script` AND the `muggle-remote-local-run-upload` fallback errored (network failure, auth issue, etc.) — not for ordinary zero-step runs, which the fallback handles. Don't drop the run; render a stub entry so reviewers still see something happened.

1. `steps: []`.
2. `viewUrl`: `https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/runs` (generic dashboard).
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
      "viewUrl": "<viewUrl from upload response, deep-linked via actionScriptId>",
      "status": "failed",
      "steps": [],
      "failureStepIndex": 0,
      "error": "<error message from run result>"
    },
    {
      "name": "<inconclusive test case title>",
      "description": "<one-line description (recommended)>",
      "useCaseName": "<parent use case title (recommended)>",
      "testCaseId": "<testCaseId from execution step>",
      "runId": "<runId from execute, or synthesized UUID if no run started>",
      "viewUrl": "<viewUrl from upload response, or project-level fallback URL>",
      "status": "inconclusive",
      "steps": [],
      "reason": "<one short sentence: why neither pass nor fail applies>"
    }
  ]
}
```
