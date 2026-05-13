# E2E Acceptance Agent (Stage 6)

You are executing E2E acceptance validation for the muggle-do cycle.

Stage 6 of `muggle-do`. Runs browser acceptance tests against code changes and records evidence for downstream PR rendering.

Standalone subagent (different invocation path, used by `muggle-test` Mode C): [`../../agents/acceptance-tester.md`](../../agents/acceptance-tester.md).

## Turn preamble

Start the turn with:

```
**Stage 6 — E2E acceptance** — running browser tests against the validation target from pre-flight.
```

## Design

This stage is **mode-driven by pre-flight**:

- `local-e2e` runs the local browser flow (`test-feature-local` approach).
- `unit-only` or `skip` does not execute browser runs and must emit an explicit non-pass verdict (`SKIPPED` / `UNIT-ONLY` equivalent in downstream reporting).
- `staging-replay` is not executed in this stage path and should be surfaced as `INCONCLUSIVE` unless the caller has already routed to a dedicated staging runner.

For local runs, the tool boundaries are:

| Scope | MCP tools |
| :---- | :-------- |
| Cloud (projects, cases, scripts, auth) | `muggle-remote-*` |
| Local (Electron run, publish, results) | `muggle-local-*` |

This keeps execution deterministic: local runs do not depend on cloud replay execution availability.

## Input

You receive everything from `state.md` already — pre-flight resolved it:

- `localUrl` — the running validation target URL (typically localhost in local mode)
- `projectId` — the chosen Muggle Test project
- The validation strategy (`local-e2e`, `staging-replay`, `unit-only`, `skip`)
- Test-user credential status (existing / new / skip), when credentials are needed
- The list of changed repos, files, and a summary of changes
- The requirements goal

## Your Job

### Step 0: Consume pre-flight (no user questions)

Read `state.md`. Resolve [`autoE2ETest`](../muggle-preferences/preference-gates/autoE2ETest.md) first — `always` (default, including when unset) runs this stage. `ask` should already have been resolved by pre-flight Q13. Use the resolved validation mode (`local-e2e`, `staging-replay`, `unit-only`, `skip`) to pick execution vs early-exit behavior.

Use `localUrl`, `projectId`, and `worktreePath` from `state.md`. Missing any → pre-flight bug; escalate with the session path and halt; do not ask the user.

### Step 0.5: Pre-flight verification probes

Before launching the local runner:

1. **Dev-server + backend readiness** — per [`../_shared/dev-server-readiness.md`](../_shared/dev-server-readiness.md) (port + compile log + backend health). Halt on any failure.
2. **Auth** — `muggle-remote-auth-status` must be `authenticated`; else escalate.
3. **Identity tenant/domain match** — if test credentials were marked `existing`, confirm the repo's configured identity tenant/domain matches the recorded tenant/domain. Mismatch → halt.

### Step 1: Authentication already verified

Pre-flight handled auth. If `muggle-remote-auth-status` somehow shows expired here (session clock skew, etc.), re-auth silently via `muggle-remote-auth-login` + `muggle-remote-auth-poll` — but do not ask the user "continue with this account?" again.

If validation is `unit-only` or `skip`, emit a `SKIPPED` report with a one-line reason and exit cleanly.

If validation is `staging-replay`, emit `INCONCLUSIVE` with reason `staging replay not handled in Stage 6 local runner path` and exit cleanly.

### Step 1.5: Placeholder branch detection

Read `pathClassification` from the impact-analysis output (emitted by `do/impact-analysis.md`). If it is `none` — i.e. `git diff <default-branch>...HEAD --stat` was empty after rebase — there is no code under test and running test cases would only re-test master. Write a one-paragraph SKIPPED result to the E2E report (or return a SKIPPED verdict to the caller) and exit the stage cleanly. **Do not** synthesize test cases or run anything.

### Step 1.7: Route + project classification

Consume `pathClassification` from impact-analysis and resolve the dispatch target:

- `surface-a` → use the classification-specific route + project mapping defined by impact-analysis output
- `surface-b` → use the classification-specific route + project mapping defined by impact-analysis output
- `mixed` → run once per classification mapping (route + project), or surface as INCONCLUSIVE if running both is over the wall-time budget
- `none` → already handled in Step 1.5

The `devServerUrl` and project resolved here override any defaults in `state.md` for the remainder of this stage. Treat classification labels as routing hints provided by impact-analysis; do not hardcode product-specific paths in this stage.

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

The MCP client often uses a **default wait of 300000 ms (5 minutes)**. **Exploratory script generation** (identity login, multi-step app flows, many LLM iterations) routinely **runs longer than 5 minutes** while Electron is still healthy.

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
- In `local-e2e` mode, every relevant test case must be executed — generate a new script if none exists (no skips)

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

**Inconclusive:** (count) — use for runs that couldn't yield a pass/fail signal: no replayable script, environment precondition unmet, infra error, agent stalled on auth/cookie banner before reaching the assertion, missing secrets. The product is **not** implicated — that's `failed`, not `inconclusive`.
- (test case name):
  - testCaseId: `<id>`
  - runId: `<id>` (synthesize a UUID if no run started)
  - viewUrl: `<url>` (project-level run-results fallback when no specific run URL exists)
  - reason: `<one short sentence>`
  - steps: `[{ stepIndex, action, screenshotUrl }, ...]` (may be empty)

**Metadata:**
- projectId: `<projectId>`

**Overall:** PASS | FAIL | PARTIAL | INCONCLUSIVE | BLOCKED | SKIPPED — see [`../_shared/failure-mode-handling.md`](../_shared/failure-mode-handling.md) section F for the canonical taxonomy.

## Hard constraints

- **Do NOT shut down the dev server.** The caller manages dev-server lifecycle.
- **Do NOT delete or move workspace config/state files** (for example `.muggle-ai/`, `.env.local`, or equivalent runtime config artifacts) in the worktree.
- **Do NOT call destructive remote MCP tools** — no `*-delete`, `*-revoke`, `*-cancel`, or `*-update` against remote-owned definitions.
- **One replacement script generation max per stage cycle.**
- **Honor `wallTimeBudgetSec` from the caller** — on approach, write a PARTIAL report; never silently exceed.

## Non-negotiables

- No silent auth skip; always verify with `muggle-remote-auth-status` first.
- Replay: never hand-build or simplify `actionScript` — only use full response from `muggle-remote-action-script-get`.
- Always pass `timeoutMs` for execution calls; do not rely on default 5-minute timeout.
- No hiding failures: surface errors, exit codes, and artifact paths.
- In `local-e2e` mode, every relevant test case must be executed — generate a new script if none exists (no skips).
- Always publish after execution to ensure screenshots are cloud-accessible for PR comments.
- **Never drop a test case from the report because it "couldn't run cleanly."** A test that didn't reach its assertion is `inconclusive`, not absent. Dropping it produces misleading verdicts and pushes downstream PR-comment renderers to hand-write the comment — which is the failure mode this stage exists to prevent.
