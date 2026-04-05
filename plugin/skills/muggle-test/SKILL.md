---
name: test
description: "Run change-driven QA testing using Muggle AI — detects local code changes, maps them to use cases, and generates test scripts either locally (real browser on localhost) or remotely (cloud execution on a preview/staging URL). Publishes results to Muggle dashboard, opens them in the browser, and posts QA summaries with screenshots to the PR. Use this skill whenever the user wants to test their changes, run QA on recent work, validate what they've been working on, or check if their code changes broke anything. Triggers on: 'test my changes', 'run tests on my changes', 'QA my work', 'check my changes', 'validate my changes', 'test before I push', 'make sure my changes work', 'regression test my changes', 'test on preview', 'test on staging'. This is the go-to skill for change-driven testing — it handles everything from change detection to test execution to result reporting."
---

# Muggle Test — Change-Driven QA Router

A router skill that detects code changes, resolves impacted test cases, executes them locally or remotely, publishes results to the Muggle AI dashboard, and posts QA summaries to the PR. The user can invoke this at any moment, in any state.

## Step 1: Confirm Scope of Work (Always First)

Parse the user's query and explicitly confirm their expectation. There are exactly two modes:

### Mode A: Local Test Generation
> Test impacted use cases/test cases against **localhost** using the Electron browser.
>
> Execution tool: `muggle-local-execute-test-generation`

Signs the user wants this: mentions "localhost", "local", "my machine", "dev server", "my changes locally", or just "test my changes" in a repo context.

### Mode B: Remote Test Generation
> Ask Muggle's cloud to generate test scripts against a **preview/staging URL**.
>
> Execution tool: `muggle-remote-workflow-start-test-script-generation`

Signs the user wants this: mentions "preview", "staging", "deployed", "preview URL", "test on preview", "test the deployment", or provides a non-localhost URL.

### Confirming

State back what you understood:
> "I'll [run local test generation against localhost / trigger remote test generation on your preview URL] for the use cases impacted by your changes. Sound right?"

If ambiguous, ask:
> "Do you want to test a feature locally (I'll launch a browser on your machine against localhost) or something on a public URL (Muggle cloud tests against a preview/staging URL)?"

Only proceed after the user confirms.

## Step 2: Detect Local Changes

Analyze the working directory to understand what changed.

1. Run `git status` and `git diff --stat` for an overview
2. Run `git diff` (or `git diff --cached` if staged) to read actual diffs
3. Identify impacted feature areas:
   - Changed UI components, pages, routes
   - Modified API endpoints or data flows
   - Updated form fields, validation, user interactions
4. Produce a concise **change summary** — a list of impacted features

Present:
> "Here's what changed: [list]. I'll scope QA testing to these areas."

If no changes detected (clean tree), tell the user and ask what they want to test.

## Step 3: Authenticate

1. Call `muggle-remote-auth-status`
2. If authenticated and not expired → proceed
3. If not authenticated or expired → call `muggle-remote-auth-login`
4. If login pending → call `muggle-remote-auth-poll`

If auth fails repeatedly, suggest: `muggle logout && muggle login` from terminal.

## Step 4: Find or Create Project

1. Call `muggle-remote-project-list`
2. Match projects against the current repo (by name, URL, description)
3. **If match found**: Recommend the best match, confirm with user
4. **If no match**: Ask the user to create a new project:
   - Propose `projectName` from repo name
   - Propose `description` from repo purpose
   - Ask for the production/preview URL
   - Call `muggle-remote-project-create`

Store the `projectId`.

## Step 5: Resolve Use Cases from Changes

### 5a: List existing use cases
Call `muggle-remote-use-case-list` with the project ID.

### 5b: Map changes to use cases
For each impacted feature from Step 2:
- If an existing use case covers it → mark "existing"
- If not covered → draft a new use case prompt

### 5c: Present mapping for user confirmation

```
Change Area         → Use Case                  Status
──────────────────────────────────────────────────────
Login form update   → "User Login Flow"         Existing (UC-123)
New checkout page   → "Checkout Process"         NEW — will create
Profile settings    → "Profile Management"       Existing (UC-456)
```

> "Does this mapping look right? I'll create the new use cases and scope test generation to all of them."

Wait for user confirmation before proceeding.

### 5d: Create new use cases
For use cases marked "NEW":
1. Call `muggle-remote-use-case-create-from-prompts`:
   - `projectId`: The project ID
   - `prompts`: Array of `{ instruction: "..." }` with clear user stories

## Step 6: Resolve Test Cases

For each use case (existing and new):

1. Call `muggle-remote-test-case-list-by-use-case` with the use case ID
2. If test cases exist → use them
3. If none exist → call `muggle-remote-test-case-generate-from-prompt`:
   - `projectId`, `useCaseId`, `instruction` (scenario based on change analysis)
4. Then call `muggle-remote-test-case-create` to save

Present the full scope to the user:

```
Use Case               Test Case                     Status
────────────────────────────────────────────────────────────
User Login Flow        Login with valid credentials   Existing
User Login Flow        Login with invalid password    Existing
Checkout Process       Complete checkout flow         NEW — will create
```

> "I'll run test generation for these [N] test cases. Confirm to proceed."

## Step 7A: Execute — Local Mode

### Ask for local URL and approval

> "Your local app should be running. What's the URL? (e.g., http://localhost:3000)"
>
> "I'll launch the Muggle browser [N] times, once per test case. Approve?"

### Run sequentially

For each test case:

1. Call `muggle-remote-test-case-get` to fetch full details
2. Call `muggle-local-execute-test-generation`:
   - `testCase`: Full test case object from step 1
   - `localUrl`: User's local URL
   - `approveElectronAppLaunch`: `true`
3. Store the returned `runId`

If a generation fails, log it and continue to the next. Do not abort the batch.

### Collect results

For each `runId`, call `muggle-local-run-result-get`. Extract: status, duration, step count, `artifactsDir`.

### Publish each run to cloud

For each completed run, call `muggle-local-publish-test-script`:
- `runId`: The local run ID
- `cloudTestCaseId`: The cloud test case ID

This returns:
- `viewUrl`: Direct link to view this test run on the Muggle AI dashboard
- `testScriptId`, `actionScriptId`, `workflowRuntimeId`

Store every `viewUrl` — these are used in the next steps.

### Report summary

```
Test Case                  Status    Duration   Steps   View on Muggle
─────────────────────────────────────────────────────────────────────────
Login with valid creds     PASSED    12.3s      8       https://www.muggle-ai.com/...
Login with invalid creds   PASSED    9.1s       6       https://www.muggle-ai.com/...
Checkout flow              FAILED    15.7s      12      https://www.muggle-ai.com/...
─────────────────────────────────────────────────────────────────────────
Total: 3 tests | 2 passed | 1 failed | 37.1s
```

For failures: show which step failed, the local screenshot path, and a suggestion.

## Step 7B: Execute — Remote Mode

### Ask for target URL

> "What's the preview/staging URL to test against?"

### Trigger remote workflows

For each test case:

1. Call `muggle-remote-test-case-get` to fetch full details
2. Call `muggle-remote-workflow-start-test-script-generation`:
   - `projectId`: The project ID
   - `useCaseId`: The use case ID
   - `testCaseId`: The test case ID
   - `name`: `"muggle-test: {test case title}"`
   - `url`: The preview/staging URL
   - `goal`: From the test case
   - `precondition`: From the test case (use `"None"` if empty)
   - `instructions`: From the test case
   - `expectedResult`: From the test case
3. Store the returned workflow runtime ID

### Monitor and report

For each workflow, call `muggle-remote-wf-get-ts-gen-latest-run` with the runtime ID.

```
Test Case                  Workflow Status   Runtime ID
────────────────────────────────────────────────────────
Login with valid creds     RUNNING           rt-abc123
Login with invalid creds   COMPLETED         rt-def456
Checkout flow              QUEUED            rt-ghi789
```

## Step 8: Open Results in Browser

After execution and publishing are complete, open the Muggle AI dashboard so the user can visually inspect results and screenshots.

### Mode A (Local) — open each published viewUrl

For each published run's `viewUrl`:
```bash
open "https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/scripts?modal=details&testCaseId={testCaseId}"
```

If there are many runs (>3), open just the project-level runs page instead of individual tabs:
```bash
open "https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/runs"
```

### Mode B (Remote) — open the project runs page

```bash
open "https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/runs"
```

Tell the user:
> "I've opened the Muggle AI dashboard in your browser — you can see the test results, step-by-step screenshots, and action scripts there."

## Step 9: Post QA Results to PR

After reporting results, check if there's an open PR for the current branch and attach the QA summary.

### 9a: Find the PR

```bash
gh pr view --json number,url,title 2>/dev/null
```

- If a PR exists → post results as a comment
- If no PR exists → ask: "No open PR found for this branch. Want me to create one with the QA results included?"
  - If yes: create PR with QA results in the body (use `gh pr create`)
  - If no: skip this step

### 9b: Build the QA comment body

Construct a markdown comment with the full QA breakdown. The format links each test case to its detail page on the Muggle AI dashboard, so PR reviewers can click through to see step-by-step screenshots and action scripts.

```markdown
## 🧪 Muggle AI — QA Results

**X passed / Y failed** | [View all on Muggle AI](https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/runs)

| Test Case | Status | Details |
|-----------|--------|---------|
| [Login with valid creds](https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/scripts?modal=details&testCaseId={testCaseId}) | ✅ PASSED | 8 steps, 12.3s |
| [Login with invalid creds](https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/scripts?modal=details&testCaseId={testCaseId}) | ✅ PASSED | 6 steps, 9.1s |
| [Checkout flow](https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/scripts?modal=details&testCaseId={testCaseId}) | ❌ FAILED | Step 7: "Click checkout button" — element not found |

<details>
<summary>Failed test details</summary>

### Checkout flow
- **Failed at**: Step 7 — "Click checkout button"
- **Error**: Element not found
- **Local artifacts**: `~/.muggle-ai/sessions/{runId}/`
- **Screenshots**: `~/.muggle-ai/sessions/{runId}/screenshots/`

</details>

---
*Generated by [Muggle AI](https://www.muggle-ai.com) — change-driven QA testing*
```

### 9c: Post to the PR

If PR already exists — add as a comment:
```bash
gh pr comment {pr-number} --body "$(cat <<'EOF'
{the QA comment body from 9b}
EOF
)"
```

If creating a new PR — include the QA section in the PR body alongside the usual summary/changes sections.

### 9d: Confirm to user

> "QA results posted to PR #{number}. Reviewers can click the test case links to see step-by-step screenshots on the Muggle AI dashboard."

## Tool Reference

| Phase | Tool | Mode |
|:------|:-----|:-----|
| Auth | `muggle-remote-auth-status` | Both |
| Auth | `muggle-remote-auth-login` | Both |
| Auth | `muggle-remote-auth-poll` | Both |
| Project | `muggle-remote-project-list` | Both |
| Project | `muggle-remote-project-create` | Both |
| Use Case | `muggle-remote-use-case-list` | Both |
| Use Case | `muggle-remote-use-case-create-from-prompts` | Both |
| Test Case | `muggle-remote-test-case-list-by-use-case` | Both |
| Test Case | `muggle-remote-test-case-generate-from-prompt` | Both |
| Test Case | `muggle-remote-test-case-create` | Both |
| Test Case | `muggle-remote-test-case-get` | Both |
| Execute | `muggle-local-execute-test-generation` | Local |
| Execute | `muggle-remote-workflow-start-test-script-generation` | Remote |
| Results | `muggle-local-run-result-get` | Local |
| Results | `muggle-remote-wf-get-ts-gen-latest-run` | Remote |
| Publish | `muggle-local-publish-test-script` | Local |
| Browser | `open` (shell command) | Both |
| PR | `gh pr view`, `gh pr comment`, `gh pr create` | Both |

## Guardrails

- **Always confirm intent first** — never assume local vs remote without asking
- **Always present the use case / test case scope** and wait for user confirmation before executing
- **Never launch Electron without explicit user approval** (`approveElectronAppLaunch`)
- **Never silently drop test cases** — log failures and continue, then report them
- **Never guess the URL** — always ask the user for localhost or preview URL
- **Always publish before opening browser** — the dashboard needs the published data to show results
- **Always check for PR before posting** — don't create a PR comment if there's no PR (ask user first)
- **Can be invoked at any state** — if the user already has a project or use cases set up, skip to the relevant step rather than re-doing everything
