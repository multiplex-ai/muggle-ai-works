# E2eReport Assembly Guide

Include **all** runs — passed, failed, **and inconclusive**. Never drop a run. Always best-effort to upload so the dashboard has a record reviewers can open from the PR — even when the local run produced zero action steps.

## Picking a status

| Status | Use when | Required extras |
|---|---|---|
| `passed` | Run completed and the assertion held. | — |
| `failed` | Run completed and the assertion failed, or the product itself broke before the assertion could be made (server error, 500, broken page). | `failureStepIndex`, `error` |
| `inconclusive` | Run could not yield a pass/fail signal for reasons **outside the product**: no replayable script existed, environment precondition unmet, infra/Electron error, agent stalled on a cookie banner or login wall, missing secrets, agent went off-course. | `reason` (one short sentence). Include every step the run produced; `steps[]` is empty only when it produced none. |

If a test should be inconclusive but you don't have a real `runId` / `viewUrl` (e.g., generation never ran), use the same project-level dashboard fallback as the "last-resort" failed branch below: synthesize a UUID-shaped runId and use the project runs page as `viewUrl`. The schema requires both fields — but a working dashboard link is better than nothing.

A record skipped because its test case's primary failed never ran either: an `inconclusive` entry with `reason: "primary failed"`, the `runSettingsId` and `resolutionLabel` the caller carried for it, `steps: []`, and that same synthesized `runId` and project-level `viewUrl`.

## Published run (passed or failed; the common path)

The studio publishes every completed local run — pass or fail, with or without action steps — to the cloud during execution. `muggle-local-run-result-get` carries `viewUrl` and `cloudActionScriptId`; `cloudTestScriptId` is **only present for passing runs and replays** (failed generations skip the test script wrapper to avoid clobbering the canonical replay target).

Fetch step screenshots in parallel — pick the right tool per run result:

- **`cloudTestScriptId` present** → `muggle-remote-test-script-get` with that id.
- **`cloudTestScriptId` missing** (failed generation) → `muggle-remote-action-script-get` with `cloudActionScriptId`. Same `steps[]` + `summaryStep` shape; just one less hop.

For each result:

1. Build `steps[]`: `[{ stepIndex: <index>, action: steps[i].operation.action, description: steps[i].briefExplanation, screenshotUrl: steps[i].operation.screenshotUrl }, ...]`. `action` is only the operation verb (`navigate`, `click`); `description` is the agent's readable account of the step and is what the walkthrough shows — omit it only when the step has no `briefExplanation`. A non-passing run carries its steps too: fetch them with the fallback above rather than sending `[]`, which collapses its walkthrough entry to a single ending frame. Send `[]` only when the run genuinely produced no steps; those still render the failure summary header.
   Add each step's `afterScreenshotUrl` — the page after the step acted, which the action script does not store. It is the `operation.screenshotUrl` of the next step that has one, skipping steps without a screenshot (`noOp`, `proceed`, `proposeStep`, `curl`, `secretSave`, `generateManagedProfile`), and for the last such step the `summaryStep.operation.screenshotUrl`. Omit it when neither exists; the walkthrough then shows the before screenshot alone. This is the same pairing the Muggle AI dashboard shows.
2. `viewUrl` — from the run result (deep-links to the specific run).
3. `status` — from `muggle-local-run-result-get`.
4. If failed: also capture `failureStepIndex`, `error`, `artifactsDir` from the run result.
5. If the caller hands over a `baselineRunId` for a failed entry — a run of the same test case against the base that failed too — set it on the entry. `build-pr-section` credits it only after checking the run itself: same test case, failed, same runSettings record, and a stack that served a base commit between the PR's fork point and the base tip. A credited failure reads "also fails on base" and stops holding the walkthrough check red; a refused one is named on stderr and stays a plain failure. Pass `--base <branch>` when the PR does not target the remote's default branch.

## Last-resort: no cloud refs on the run result

Reach this branch only when the run result carries no `viewUrl` / `cloudActionScriptId` (the studio publish never landed — older Electron build, network failure, auth issue). Don't drop the run; render a stub entry so reviewers still see something happened.

1. `steps: []`.
2. `viewUrl`: the project runs page — the `dashboardUrl` field of `muggle-remote-project-test-runs-summary-get` for the project. It is resolved against the lane the MCP runs on; a hand-written `www.muggle-ai.com` URL is a dead link on staging.
3. `status: "failed"`, `failureStepIndex: 0`, `error` from run result.
4. `testCaseId` — from execution step selection. `runId` — from `muggle-local-execute-test-generation` (always present even on failure).

On every entry: `description` (test case title/description — drives the collapsible header) and `useCaseName` (parent use case title — when present, the overview groups by use case) are optional but recommended. Prefer values already in context; only call `muggle-remote-test-case-get` / `muggle-remote-use-case-get` if missing.

Set `testCaseShortId` to the test case's `shortId` and `replayShortId` to the run's `shortId` (e.g. `TC-42`, `R-2051`) whenever the record you already fetched carries one; the walkthrough then labels the test `TC-42 · <name>` and leads its run row with `R-2051`. Omit either when absent — entities created before short IDs existed have none.

Set `runSettingsId` to the run result's `cloudRunSettingsId` (`muggle-local-run-result-get` prints it as `**Cloud Run Settings ID:**`) and `resolutionLabel` to that record's window size as `<width>×<height>` (e.g. `390×844`): the `resolutionLabel` the caller carried for the run when it has one, else the `resolutionLabel` `muggle-remote-run-settings-list` returns for that `runSettingsId` (with `runEnvironmentType: "local"`), or the `displayResolution` the run executed at, written the same way (`R_0390x0844` → `390×844`). The walkthrough keeps each record of a test case as its own entry, labelled `<name> (390×844)`, and collapses only reruns of one record to the latest. Omit both when the run result carries no `cloudRunSettingsId`; the entry then collapses with the test case's other runs.

If called from `muggle-do`: `e2e-acceptance.md` already produces this shape, each entry's `runSettingsId` and `resolutionLabel` included — pass it through unchanged.

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
      "testCaseShortId": "<test case shortId, when it has one>",
      "runSettingsId": "<cloudRunSettingsId from run result, when it has one>",
      "resolutionLabel": "<that record's size, e.g. 390×844>",
      "testScriptId": "<cloudTestScriptId from run result>",
      "runId": "<runId from muggle-local-execute-test-generation>",
      "replayShortId": "<run shortId, when it has one>",
      "viewUrl": "<viewUrl from run result>",
      "status": "passed",
      "steps": [{ "stepIndex": 0, "action": "click", "description": "Click 'Accept all' to dismiss the cookie consent dialog.", "screenshotUrl": "..." }]
    },
    {
      "name": "<failed test case title>",
      "description": "<one-line description (recommended)>",
      "useCaseName": "<parent use case title (recommended)>",
      "testCaseId": "<testCaseId from execution step>",
      "runId": "<runId from muggle-local-execute-test-generation>",
      "viewUrl": "<viewUrl from run result>",
      "status": "failed",
      "steps": [{ "stepIndex": 0, "action": "click", "description": "Click 'Sign in' to open the login form.", "screenshotUrl": "..." }],
      "failureStepIndex": 0,
      "error": "<error message from run result>"
    },
    {
      "name": "<inconclusive test case title>",
      "description": "<one-line description (recommended)>",
      "useCaseName": "<parent use case title (recommended)>",
      "testCaseId": "<testCaseId from execution step>",
      "runId": "<runId from execute, or synthesized UUID if no run started>",
      "viewUrl": "<viewUrl from run result, or project-level fallback URL>",
      "status": "inconclusive",
      "steps": [{ "stepIndex": 0, "action": "navigate", "description": "Workflow started at the app's URL.", "screenshotUrl": "..." }],
      "reason": "<one short sentence: why neither pass nor fail applies>"
    }
  ]
}
```
