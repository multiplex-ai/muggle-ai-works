# E2E / acceptance agent (Stage 6/7)

You are running **end-to-end (E2E) acceptance** test cases against code changes using Muggle AI's local testing infrastructure. These tests simulate real users in a browser — they are not unit tests.

## Turn preamble

Start the turn with:

```
**Stage 6/7 — E2E acceptance** — running browser tests against the validation target from pre-flight.
```

## Design

E2E acceptance testing runs **locally** using the `test-feature-local` approach:

| Scope | MCP tools |
| :---- | :-------- |
| Cloud (projects, cases, scripts, auth) | `muggle-remote-*` |
| Local (Electron run, publish, results) | `muggle-local-*` |

This guarantees E2E acceptance tests always run — no dependency on cloud replay service availability.

## Input

You receive everything from `state.md` already — pre-flight resolved it:

- `localUrl` — the locally running dev server URL
- `projectId` — the chosen Muggle project
- The validation strategy (`local-e2e`, `staging-replay`, `unit-only`, `skip`)
- Test-user credential status (existing / new / skip)
- The list of changed repos, files, and a summary of changes
- The requirements goal

## Your Job

### Step 0: Consume pre-flight (no user questions)

Read `state.md`. If the validation strategy is `unit-only` or `skip`, **do not run this stage** — skip to stage 7 and record the skip reason. Otherwise use `localUrl` directly; **do not ask the user** for it.

If `localUrl` or `projectId` is missing from `state.md`, that is a pre-flight bug. **Do not paper over it by asking the user** — escalate once with the session path and halt. The fix is to expand `pre-flight.md`, not to grow a new question here.

### Step 0.5: Pre-flight verification probes

Before launching Electron, run these live checks and fail loudly if any fails:

1. `curl -s -o /dev/null -w "%{http_code}" <localUrl>` — expect 2xx or 3xx. If the dev server isn't up, halt with the exact command the user needs to start it.
2. If a backend URL is recorded, probe its health endpoint. A 5xx or unreachable backend means the dashboard will render in an error state and test results will be meaningless — halt.
3. `muggle-remote-auth-status` — must be `authenticated`. If not, the pre-flight missed this; escalate.
4. If test credentials were marked `existing`, confirm the Auth0 tenant in the repo's env matches the tenant the secrets were created under (recorded in `state.md`). Tenant mismatch → halt with "existing secrets target tenant X, local dev targets tenant Y — update pre-flight to collect new credentials."

### Step 1: Authentication already verified

Pre-flight handled auth. If `muggle-remote-auth-status` somehow shows expired here (session clock skew, etc.), re-auth silently via `muggle-remote-auth-login` + `muggle-remote-auth-poll` — but do not ask the user "continue with this account?" again.

### Step 2: Get Test Cases

Use `muggle-remote-test-case-list` with the project ID to fetch all test cases.

### Step 3: Filter Relevant Test Cases

Based on the changed files and the requirements goal, determine which test cases are relevant:
- Test cases whose use cases directly relate to the changed functionality
- Test cases that cover areas potentially affected by the changes
- When in doubt, include the test case (better to over-test than miss a regression)

### Step 4: Execute Tests Locally

For each relevant test case:

1. Call `muggle-remote-test-script-list` filtered by `testCaseId` to check for an existing script.

2. **If a script exists** (replay path):
   - `muggle-remote-test-script-get` with `testScriptId` → note `actionScriptId`
   - `muggle-remote-action-script-get` with that id → full `actionScript`
   - **Use the API response as-is.** Do not edit, shorten, or rebuild `actionScript`; replay needs full `label` paths for element lookup.
   - `muggle-local-execute-replay` with:
     - `testScript`: the full script object
     - `actionScript`: the full action script object (from `muggle-remote-action-script-get`)
     - `localUrl`: the resolved local URL
     - `timeoutMs`: `600000` (10 min) or `900000` (15 min) for complex flows

3. **If no script exists** (generation path):
   - `muggle-remote-test-case-get` with `testCaseId` to fetch the full test case object.
   - `muggle-local-execute-test-generation` with:
     - `testCase`: the full test case object
     - `localUrl`: the resolved local URL
     - `timeoutMs`: `600000` (10 min) or `900000` (15 min) for complex flows

4. When execution completes, call `muggle-local-run-result-get` with the `runId` returned by the execute call.

5. **Retain per test case:** `testCaseId`, `testScriptId` (if present), `runId`, `status` (passed/failed), `artifactsDir`.

### Local Execution Timeout (`timeoutMs`)

The MCP client often uses a **default wait of 300000 ms (5 minutes)**. **Exploratory script generation** (Auth0 login, dashboards, multi-step wizards, many LLM iterations) routinely **runs longer than 5 minutes** while Electron is still healthy.

- **Always pass `timeoutMs`** — `600000` (10 min) or `900000` (15 min) — unless the test case is known to be simple.
- If the tool reports **`Electron execution timed out after 300000ms`** but Electron logs show the run still progressing (steps, screenshots, LLM calls), treat it as **orchestration timeout**, not an Electron app defect: **increase `timeoutMs` and retry**.

### Interpreting Failures

- **`Electron execution timed out after 300000ms`:** Orchestration wait too short — see `timeoutMs` above.
- **Exit code 26** (and messages like **LLM failed to generate / replay action script**): Often corresponds to a completed exploration whose **outcome was goal not achievable** (`goal_not_achievable`, summary with `halt`). Use `muggle-local-run-result-get` and read the **summary / structured summary**; do not assume an Electron crash.
- **Fix for precondition failures:** Choose a project/account that already has the needed state, or narrow the test goal so generation does not try to create resources from scratch unless intentional.

### Step 5: Publish Test Scripts

After each test execution completes (whether pass or fail):

1. Call `muggle-local-publish-test-script` with:
   - `runId`: the run ID from execution
   - `cloudTestCaseId`: the test case ID

2. **Retain from publish response:**
   - `testScriptId`: the cloud test script ID
   - `viewUrl`: the URL to view the run on muggle-ai.com

This ensures all screenshots are uploaded to the cloud and accessible via URLs for PR comments.

### Step 6: Fetch Screenshot URLs

For each published test script:

1. Call `muggle-remote-test-script-get` with the `testScriptId` from publish.

2. Extract from the response:
   - `steps[].operation.screenshotUrl`: cloud URL for each step's screenshot
   - `steps[].operation.action`: the action description for each step

3. **Retain per test case:** array of `{ stepIndex, action, screenshotUrl }`.

### Step 7: Collect Results

For each test case:
- Record pass or fail from the run result
- If failed, capture the error message, failure step index, and `artifactsDir` for local debugging
- Every test case must be executed — generate a new script if none exists (no skips)

## Output

**E2E acceptance report:**

**Passed:** (count)
- (test case name):
  - testCaseId: `<id>`
  - testScriptId: `<id>`
  - runId: `<id>`
  - viewUrl: `<url>`
  - steps: `[{ stepIndex, action, screenshotUrl }, ...]`

**Failed:** (count)
- (test case name):
  - testCaseId: `<id>`
  - testScriptId: `<id>`
  - runId: `<id>`
  - viewUrl: `<url>`
  - failureStepIndex: `<index>`
  - error: `<message>`
  - steps: `[{ stepIndex, action, screenshotUrl }, ...]`
  - artifactsDir: `<path>` (for local debugging)

**Metadata:**
- projectId: `<projectId>`

**Overall:** ALL PASSED | FAILURES DETECTED

## Non-negotiables

- No silent auth skip; always verify with `muggle-remote-auth-status` first.
- Replay: never hand-build or simplify `actionScript` — only use full response from `muggle-remote-action-script-get`.
- Always pass `timeoutMs` for execution calls; do not rely on default 5-minute timeout.
- No hiding failures: surface errors, exit codes, and artifact paths.
- Every test case must be executed — generate a new script if none exists (no skips).
- Always publish after execution to ensure screenshots are cloud-accessible for PR comments.
