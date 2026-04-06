---
name: muggle-test
description: "Run change-driven E2E acceptance testing using Muggle AI — detects local code changes, maps them to use cases, and generates test scripts either locally (real browser on localhost) or remotely (cloud execution on a preview/staging URL). Publishes results to Muggle dashboard, opens them in the browser, and posts E2E acceptance summaries with screenshots to the PR. Use this skill whenever the user wants to test their changes, run E2E acceptance tests on recent work, validate what they've been working on, or check if their code changes broke anything. Triggers on: 'test my changes', 'run tests on my changes', 'acceptance test my work', 'check my changes', 'validate my changes', 'test before I push', 'make sure my changes work', 'regression test my changes', 'test on preview', 'test on staging'. This is the go-to skill for change-driven E2E acceptance testing — it handles everything from change detection to test execution to result reporting."
---

# Muggle Test — Change-Driven E2E Acceptance Router

A router skill that detects code changes, resolves impacted test cases, executes them locally or remotely, publishes results to the Muggle AI dashboard, and posts E2E acceptance summaries to the PR. The user can invoke this at any moment, in any state.

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

If the user's intent is clear, state back what you understood and ask for confirmation:
```
I'll run [local/remote] test generation. Confirm?
──────────────────────────────────────────────────────────────
1. Yes, proceed
2. No, switch to [the other mode]
──────────────────────────────────────────────────────────────
```

If ambiguous, ask the user to choose:
```
How do you want to run the test?
──────────────────────────────────────────────────────────────
1. Local — launch browser on your machine against localhost
2. Remote — Muggle cloud tests against a preview/staging URL
──────────────────────────────────────────────────────────────
```

Only proceed after the user selects an option.

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
> "Here's what changed: [list]. I'll scope E2E acceptance testing to these areas."

If no changes detected (clean tree), tell the user and ask what they want to test.

## Step 3: Authenticate

1. Call `muggle-remote-auth-status`
2. If authenticated and not expired → proceed
3. If not authenticated or expired → call `muggle-remote-auth-login`
4. If login pending → call `muggle-remote-auth-poll`

If auth fails repeatedly, suggest: `muggle logout && muggle login` from terminal.

## Step 4: Select Project (User Must Choose)

1. Call `muggle-remote-project-list`
2. Present **all** projects as a numbered list:

```
Available Muggle Projects:
──────────────────────────────────────────────────────────────
1. MUGGLE AI STAGING 1       https://staging.muggle-ai.com/
2. Tanka Testing             https://www.tanka.ai
3. Staging muggleTestV0      https://staging.muggle-ai.com/muggleTestV0
4. [Create new project]
──────────────────────────────────────────────────────────────
```

> "Which project should I use? Reply with the number."

3. **Wait for the user to explicitly choose** — do NOT auto-select based on repo name or URL matching
4. **If user chooses "Create new project"**:
   - Ask for `projectName`
   - Ask for `description`
   - Ask for the production/preview URL
   - Call `muggle-remote-project-create`

Store the `projectId` only after user confirms.

## Step 5: Select Use Case (User Must Choose)

### 5a: List existing use cases
Call `muggle-remote-use-case-list` with the project ID.

### 5b: Present ALL use cases as a numbered list for user selection

```
Available Use Cases for [Project Name]:
──────────────────────────────────────────────────────────────────────────
1. Sign up for Muggle Test account
2. Access existing account via login
3. Manually Add a Use Case
4. View Generated Test Script After Test Run
5. Generate comprehensive UX testing reports
6. [Create new use case]
──────────────────────────────────────────────────────────────────────────
```

> "Which use case do you want to test? Reply with the number (or multiple numbers separated by commas)."

### 5c: Wait for explicit user selection

**CRITICAL: Do NOT auto-select use cases** based on:
- Git changes analysis
- Use case title/description matching
- Any heuristic or inference

The user MUST explicitly tell you which use case(s) to use.

### 5d: If user chooses "Create new use case"
1. Ask the user to describe the use case in plain English
2. Call `muggle-remote-use-case-create-from-prompts`:
   - `projectId`: The project ID
   - `prompts`: Array of `{ instruction: "..." }` with the user's description
3. Present the created use case and confirm it's correct

## Step 6: Select Test Case (User Must Choose)

For the selected use case(s):

### 6a: List existing test cases
Call `muggle-remote-test-case-list-by-use-case` with each use case ID.

### 6b: Present ALL test cases as a numbered list for user selection

```
Available Test Cases for "[Use Case Name]":
──────────────────────────────────────────────────────────────────────────
1. E2E: Login with valid credentials
2. E2E: Login with invalid password
3. E2E: Login with expired session
4. [Generate new test case]
──────────────────────────────────────────────────────────────────────────
```

> "Which test case(s) do you want to run? Reply with the number (or multiple numbers separated by commas)."

### 6c: Wait for explicit user selection

**CRITICAL: Do NOT auto-select test cases** — the user MUST explicitly choose which test case(s) to execute.

### 6d: If user chooses "Generate new test case"
1. Ask the user to describe what they want to test in plain English
2. Call `muggle-remote-test-case-generate-from-prompt`:
   - `projectId`, `useCaseId`, `instruction` (the user's description)
3. Present the generated test case(s) for review
4. Call `muggle-remote-test-case-create` to save the ones the user approves

### 6e: Confirm final selection

> "You selected [N] test case(s): [list titles]. Ready to proceed?"

Wait for user confirmation before moving to execution.

## Step 7A: Execute — Local Mode

### Three separate questions (ask one at a time, wait for answer before next)

**Question 1 — Local URL:**
> "Your local app should be running. What's the URL? (e.g., http://localhost:3000)"

Wait for user to provide URL before asking question 2.

**Question 2 — Electron launch approval:**
```
I'll launch the Muggle Electron browser to run [N] test case(s).
──────────────────────────────────────────────────────────────
1. Yes, launch it
2. No, cancel
──────────────────────────────────────────────────────────────
```

Wait for "1" before asking question 3. If "2", stop and ask what they want to do instead.

**Question 3 — Window visibility:**
```
How should the browser window appear?
──────────────────────────────────────────────────────────────
1. Visible (watch the browser as it runs)
2. Headless (run in background)
──────────────────────────────────────────────────────────────
```

Wait for answer (1 or 2) before proceeding.

### Run sequentially

For each test case:

1. Call `muggle-remote-test-case-get` to fetch full details
2. Call `muggle-local-execute-test-generation`:
   - `testCase`: Full test case object from step 1
   - `localUrl`: User's local URL (from Question 1)
   - `approveElectronAppLaunch`: `true` (only if user said "yes" in Question 2)
   - `showUi`: `true` if user chose "visible", `false` if "headless" (from Question 3)
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
open "https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/scripts?modal=script-details&testCaseId={testCaseId}"
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

## Step 9: Post E2E Acceptance Results to PR

After reporting results, check if there's an open PR for the current branch and attach the E2E acceptance summary.

### 9a: Find the PR

```bash
gh pr view --json number,url,title 2>/dev/null
```

- If a PR exists → post results as a comment
- If no PR exists → ask:
```
No open PR found for this branch.
──────────────────────────────────────────────────────────────
1. Create PR with E2E acceptance results
2. Skip posting to PR
──────────────────────────────────────────────────────────────
```
  - If 1: create PR with E2E acceptance results in the body (use `gh pr create`)
  - If 2: skip this step

### 9b: Build the E2E acceptance comment body

Construct a markdown comment with the full E2E acceptance breakdown. The format links each test case to its detail page on the Muggle AI dashboard, so PR reviewers can click through to see step-by-step screenshots and action scripts.

```markdown
## 🧪 Muggle AI — E2E Acceptance Results

**X passed / Y failed** | [View all on Muggle AI](https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/runs)

| Test Case | Status | Details |
|-----------|--------|---------|
| [Login with valid creds](https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/scripts?modal=script-details&testCaseId={testCaseId}) | ✅ PASSED | 8 steps, 12.3s |
| [Login with invalid creds](https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/scripts?modal=script-details&testCaseId={testCaseId}) | ✅ PASSED | 6 steps, 9.1s |
| [Checkout flow](https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/scripts?modal=script-details&testCaseId={testCaseId}) | ❌ FAILED | Step 7: "Click checkout button" — element not found |

<details>
<summary>Failed test details</summary>

### Checkout flow
- **Failed at**: Step 7 — "Click checkout button"
- **Error**: Element not found
- **Local artifacts**: `~/.muggle-ai/sessions/{runId}/`
- **Screenshots**: `~/.muggle-ai/sessions/{runId}/screenshots/`

</details>

---
*Generated by [Muggle AI](https://www.muggle-ai.com) — change-driven E2E acceptance testing*
```

### 9c: Post to the PR

If PR already exists — add as a comment:
```bash
gh pr comment {pr-number} --body "$(cat <<'EOF'
{the E2E acceptance comment body from 9b}
EOF
)"
```

If creating a new PR — include the E2E acceptance section in the PR body alongside the usual summary/changes sections.

### 9d: Confirm to user

> "E2E acceptance results posted to PR #{number}. Reviewers can click the test case links to see step-by-step screenshots on the Muggle AI dashboard."

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
- **User MUST select project** — present numbered list, wait for explicit choice, never auto-select
- **User MUST select use case(s)** — present numbered list, wait for explicit choice, never auto-select based on git changes or heuristics
- **User MUST select test case(s)** — present numbered list, wait for explicit choice, never auto-select
- **Ask three separate questions for local mode** — (1) URL as text input, (2) Electron approval as numbered choice, (3) visibility as numbered choice — one at a time, wait for each answer
- **Never launch Electron without explicit user approval** (`approveElectronAppLaunch`)
- **Never silently drop test cases** — log failures and continue, then report them
- **Never guess the URL** — always ask the user for localhost or preview URL
- **Always publish before opening browser** — the dashboard needs the published data to show results
- **Use correct dashboard URL format** — `modal=script-details` (not `modal=details`)
- **Always check for PR before posting** — don't create a PR comment if there's no PR (ask user first)
- **Can be invoked at any state** — if the user already has a project or use cases set up, skip to the relevant step rather than re-doing everything
