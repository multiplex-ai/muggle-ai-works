---
name: muggle-test
description: "Run change-driven E2E acceptance testing using Muggle AI — detects local code changes, maps them to use cases, and generates test scripts either locally (real browser on localhost) or remotely (cloud execution on a preview/staging URL). Publishes results to Muggle dashboard, opens them in the browser, and posts E2E acceptance summaries with screenshots to the PR. Use this skill whenever the user wants to test their changes, run E2E acceptance tests on recent work, validate what they've been working on, or check if their code changes broke anything. Triggers on: 'test my changes', 'run tests on my changes', 'acceptance test my work', 'check my changes', 'validate my changes', 'test before I push', 'make sure my changes work', 'regression test my changes', 'test on preview', 'test on staging'. This is the go-to skill for change-driven E2E acceptance testing — it handles everything from change detection to test execution to result reporting."
---

# Muggle Test — Change-Driven E2E Acceptance Router

A router skill that detects code changes, resolves impacted test cases, executes them locally or remotely, publishes results to the Muggle AI dashboard, and posts E2E acceptance summaries to the PR. The user can invoke this at any moment, in any state.

## UX Guidelines — Minimize Typing

**Every selection-based question MUST use the `AskQuestion` tool** (or the platform's equivalent structured selection tool). Never ask the user to "reply with a number" in a plain text message — always present clickable options.

- **Selections** (project, use case, test case, mode, approval): Use `AskQuestion` with labeled options the user can click.
- **Multi-select** (use cases, test cases): Use `AskQuestion` with `allow_multiple: true`.
- **Free-text inputs** (URLs, descriptions): Only use plain text prompts when there is no finite set of options. Even then, offer a detected/default value when possible.
- **Batch related questions**: If two questions are independent, present them together in a single `AskQuestion` call rather than asking sequentially.
- **Parallelize job-creation calls**: Whenever you're kicking off N independent cloud jobs — creating multiple use cases, generating/creating multiple test cases, fetching details for multiple test cases, starting multiple remote workflows, publishing multiple local runs, or fetching per-step screenshots for multiple runs — issue all N tool calls in a single message so they run in parallel. Never loop them sequentially unless there is a real ordering constraint (e.g. a single local Electron browser that can only run one test at a time).

## Test Case Design: One Atomic Behavior Per Test Case

Every test case verifies exactly **one** user-observable behavior. Never bundle multiple concerns, sequential flows, or bootstrap/setup into a single test case — even if you think it would be "cleaner" or "more efficient."

**Ordering, dependencies, and bootstrap are Muggle's service responsibility, not yours.** Muggle's cloud handles test case dependencies, prerequisite state, and execution ordering. Your job is to describe the *atomic behavior to verify* — never the flow that gets there.

- ❌ Wrong: one test case that "signs up, logs in, navigates to the detail modal, verifies icon stacking, verifies tab order, verifies history format, and verifies reference layout."
- ✅ Right: four separate test cases — one per verifiable behavior — each with instruction text like "Verify the detail modal shows stacked pair of icons per card" with **no** signup / login / navigation / setup language.

**Never bake bootstrap into a test case description.** Signup, login, seed data, prerequisite navigation, tear-down — none of these belong inside the test case body. Write only the verification itself. The service will prepend whatever setup is needed based on its own dependency graph.

**Never consolidate the generator's output.** When `muggle-remote-test-case-generate-from-prompt` returns N micro-tests from a single prompt, that decomposition is the authoritative one. Do not "merge them into 1 for simplicity," do not "rewrite them to share bootstrap," do not "collapse them to match a 4 UC / 4 TC plan." Accept what the generator gave you.

**Never skip the generate→review cycle.** Even when you are 100% confident about the right shape, always present the generated test cases to the user before calling `muggle-remote-test-case-create`. "I'll skip the generate→review cycle and create directly" is a sign you're about to get it wrong.

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

If the user's intent is clear, state back what you understood and use `AskQuestion` to confirm:
- Option 1: "Yes, proceed"
- Option 2: "Switch to [the other mode]"

If ambiguous, use `AskQuestion` to let the user choose:
- Option 1: "On my computer — test your localhost dev server in a browser on your machine"
- Option 2: "In the cloud — test remotely targeting your deployed preview/staging URL"

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

A **project** is where all your test results, use cases, and test scripts are grouped on the Muggle AI dashboard. Pick the project that matches what you're working on.

1. Call `muggle-remote-project-list`
2. Use `AskQuestion` to present all projects as clickable options. Include the project URL in each label so the user can identify the right one. Always include a "Create new project" option at the end.

   Example labels:
   - "MUGGLE AI STAGING 1 — https://staging.muggle-ai.com/"
   - "Tanka Testing — https://www.tanka.ai"
   - "Create new project"

   Prompt: "Pick the project to group this test run into:"

3. **Wait for the user to explicitly choose** — do NOT auto-select based on repo name or URL matching
4. **If user chooses "Create new project"**:
   - Ask for `projectName`, `description`, and the production/preview URL
   - Call `muggle-remote-project-create`

Store the `projectId` only after user confirms.

## Step 5: Select Use Case (Best-Effort Shortlist)

### 5a: List existing use cases
Call `muggle-remote-use-case-list` with the project ID.

### 5b: Best-effort match against the change summary

Using the change summary from Step 2, pick the use cases whose title/description most plausibly relate to the impacted areas. Produce a **short shortlist** (typically 1–5) — don't try to be exhaustive, and don't dump the full project list on the user. A confident best-effort match is the goal.

If nothing looks like a confident match, fall back to asking the user which use case(s) they have in mind.

### 5c: Present the shortlist for confirmation

Use `AskQuestion` with `allow_multiple: true`:

Prompt: "These use cases look most relevant to your changes — confirm which to test:"

- Pre-check the shortlisted items so the user can accept with one click
- Include "Pick a different use case" to reveal the full project list
- Include "Create new use case" at the end

### 5d: If user picks "Pick a different use case"
Re-present the full list from 5a via `AskQuestion` with `allow_multiple: true`, then continue.

### 5e: If user chooses "Create new use case"
1. Ask the user to describe the use case(s) in plain English — they may want more than one
2. Call `muggle-remote-use-case-create-from-prompts` **once** with **all** descriptions batched into the `instructions` array (this endpoint natively fans out the jobs server-side — do NOT make one call per use case):
   - `projectId`: The project ID
   - `instructions`: A plain array of strings, one per use case — e.g. `["<description 1>", "<description 2>", ...]`
3. Present the created use cases and confirm they're correct

## Step 6: Select Test Case (Best-Effort Shortlist)

For the selected use case(s):

### 6a: List existing test cases
Call `muggle-remote-test-case-list-by-use-case` with each use case ID.

### 6b: Best-effort match against the change summary

Using the change summary from Step 2, pick the test cases that look most relevant to the impacted areas. Keep the shortlist small and confident — don't enumerate every test case attached to the use case(s).

If nothing looks like a confident match, fall back to offering to run all test cases for the selected use case(s), or ask the user what they had in mind.

### 6c: Present the shortlist for confirmation

Use `AskQuestion` with `allow_multiple: true`:

Prompt: "These test cases look most relevant — confirm which to run:"

- Pre-check the shortlisted items so the user can accept with one click
- Include "Show all test cases" to reveal the full list
- Include "Generate new test case" at the end

### 6d: If user chooses "Generate new test case"
1. Ask the user to describe what they want to test in plain English — they may want more than one test case
2. For N descriptions, issue N `muggle-remote-test-case-generate-from-prompt` calls **in parallel** (single message, multiple tool calls — never loop sequentially):
   - `projectId`, `useCaseId`, `instruction` (one description per call)
   - Each `instruction` must describe **exactly one atomic behavior to verify**. No signup, no login, no "first navigate to X, then click Y, then verify Z" chains, no seed data, no cleanup. Just the verification. See **Test Case Design** above.
3. **Accept the generator's decomposition as-is.** If the generator returns 4 micro-tests from a single prompt, that's 4 correct test cases — never merge, consolidate, or rewrite them to bundle bootstrap.
4. Present the generated test case(s) for user review — **always do this review cycle**, even when you think you already know the right shape. Skipping straight to creation is the anti-pattern this skill most frequently gets wrong.
5. For the ones the user approves, issue `muggle-remote-test-case-create` calls **in parallel**

### 6e: Confirm final selection

Use `AskQuestion` to confirm: "You selected [N] test case(s): [list titles]. Ready to proceed?"
- Option 1: "Yes, run them"
- Option 2: "No, let me re-select"

Wait for user confirmation before moving to execution.

## Step 7A: Execute — Local Mode

### Pre-flight question — Local URL

Try to auto-detect the dev server URL by checking running terminals or common ports (e.g., `lsof -iTCP -sTCP:LISTEN -nP | grep -E ':(3000|3001|4200|5173|8080)'`). If a likely URL is found, present it as a clickable default via `AskQuestion`:
- Option 1: "http://localhost:3000" (or whatever was detected)
- Option 2: "Other — let me type a URL"

If nothing detected, ask as free text: "Your local app should be running. What's the URL? (e.g., http://localhost:3000)"

**No separate approval or visibility question.** The user picking Local mode in Step 1 *is* the approval — do not ask "ready to launch Electron?" before every run. The Electron browser defaults to visible; if the user wants headless, they will say so, otherwise let it run visible.

### Fetch test case details (in parallel)

Before execution, fetch full test case details for all selected test cases by issuing **all** `muggle-remote-test-case-get` calls in parallel (single message, multiple tool calls).

### Run sequentially (Electron constraint)

Execution itself **must** be sequential because there is only one local Electron browser. For each test case, in order:

1. Call `muggle-local-execute-test-generation`:
   - `testCase`: Full test case object from the parallel fetch above
   - `localUrl`: User's local URL from the pre-flight question
   - `showUi`: omit (default visible) unless the user explicitly asked for headless, then pass `false`
2. Store the returned `runId`

If a generation fails, log it and continue to the next. Do not abort the batch.

### Collect results (in parallel)

For every `runId`, issue all `muggle-local-run-result-get` calls in parallel. Extract: status, duration, step count, `artifactsDir`.

### Publish each run to cloud (in parallel)

For every completed run, issue all `muggle-local-publish-test-script` calls in parallel (single message, multiple tool calls):
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

### Fetch test case details (in parallel)

Issue all `muggle-remote-test-case-get` calls in parallel (single message, multiple tool calls) to hydrate the test case bodies.

### Trigger remote workflows (in parallel)

Once details are in hand, issue all `muggle-remote-workflow-start-test-script-generation` calls in parallel — never loop them sequentially. For each test case:

- `projectId`: The project ID
- `useCaseId`: The use case ID
- `testCaseId`: The test case ID
- `name`: `"muggle-test: {test case title}"`
- `url`: The preview/staging URL
- `goal`: From the test case
- `precondition`: From the test case (use `"None"` if empty)
- `instructions`: From the test case
- `expectedResult`: From the test case

Store each returned workflow runtime ID.

### Monitor and report (in parallel)

Issue all `muggle-remote-wf-get-ts-gen-latest-run` calls in parallel, one per runtime ID.

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

## Step 9: Offer to Post Visual Walkthrough to PR

After reporting results, ask the user if they want to attach a **visual walkthrough** — a markdown block with per-test-case dashboard links and step-by-step screenshots — to the current branch's open PR. The rendering and posting workflow lives in the shared `muggle-pr-visual-walkthrough` skill; this step gathers the required input and hands off.

### 9a: Gather per-step screenshots (required input for the shared skill)

The shared skill takes an **`E2eReport` JSON** that includes per-step screenshot URLs. You already have `projectId`, `testCaseId`, `runId`, `viewUrl`, and `status` from earlier steps — you still need the step-level data.

For the published runs from Step 7A, issue **all** `muggle-remote-test-script-get` calls in parallel (single message, multiple tool calls) — one per `testScriptId` returned by `muggle-local-publish-test-script`. Then, for each response:

1. Extract `steps[].operation.action` (description) and `steps[].operation.screenshotUrl` (cloud URL).
2. Build a `steps` array: `[{ stepIndex: 0, action: "...", screenshotUrl: "..." }, ...]`.
3. If the run failed, also capture `failureStepIndex`, `error`, and the local `artifactsDir` from `muggle-local-run-result-get`.

Assemble the report:

```json
{
  "projectId": "<projectId>",
  "tests": [
    {
      "name": "<test case title>",
      "testCaseId": "<id>",
      "testScriptId": "<id>",
      "runId": "<id>",
      "viewUrl": "<publish response viewUrl>",
      "status": "passed",
      "steps": [{ "stepIndex": 0, "action": "...", "screenshotUrl": "..." }]
    }
  ]
}
```

See the shared skill for the full schema (including the failed-test shape with `failureStepIndex` and `error`).

### 9b: Ask the user

Use `AskQuestion`:

> "Post a visual walkthrough of these results to the PR? Reviewers can click each test case to see step-by-step screenshots on the Muggle AI dashboard."

- Option 1: "Yes, post to PR"
- Option 2: "Skip"

### 9c: Invoke the shared skill in Mode A

If the user chooses "Yes, post to PR", invoke the `muggle-pr-visual-walkthrough` skill via the `Skill` tool. With the `E2eReport` already in context, the skill will:

1. Call `muggle build-pr-section` to render the markdown block (fit-vs-overflow automatic)
2. Find the PR via `gh pr view`
3. Post `body` as a `gh pr comment`
4. Post the overflow `comment` as a second comment (only if the CLI emitted one)
5. Confirm the PR URL to the user

This skill always uses **Mode A** (post to an existing PR); `muggle-do` is the only caller that uses Mode B. Do not attempt to render the walkthrough markdown yourself — delegate to the shared skill.

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
| Per-step screenshots (for walkthrough) | `muggle-remote-test-script-get` | Both |
| Browser | `open` (shell command) | Both |
| PR walkthrough | `muggle-pr-visual-walkthrough` (shared skill) | Both |

## Guardrails

- **Always confirm intent first** — never assume local vs remote without asking
- **User MUST select project** — present clickable options via `AskQuestion`, wait for explicit choice, never auto-select
- **Best-effort shortlist use cases** — use the change summary to narrow the list to the most relevant 1–5 use cases and pre-check them; never dump every use case in the project on the user. Always leave an escape hatch to reveal the full list.
- **Best-effort shortlist test cases** — same idea: pre-check the test cases most relevant to the change summary; never enumerate every test case attached to a use case. Always leave an escape hatch to reveal the full list.
- **Use `AskQuestion` for every selection** — never ask the user to type a number; always present clickable options
- **Auto-detect localhost URL when possible**; only fall back to free-text when nothing is listening on a common port
- **Parallelize independent cloud jobs** — when creating N use cases, generating/creating N test cases, fetching N test case details, starting N remote workflows, polling N workflow runtimes, publishing N local runs, or fetching N per-step test scripts, issue all N calls in a single message so they fan out in parallel. The only tolerated sequential loop is local Electron execution (one browser, one test at a time). For use case creation specifically, use the native batch form of `muggle-remote-use-case-create-from-prompts` (all descriptions in one `instructions` array) instead of parallel calls.
- **One atomic behavior per test case** — every test case verifies exactly one user-observable behavior. Never bundle signup/login/navigation/bootstrap/teardown into a test case body. Ordering and dependencies are Muggle's service responsibility, not the skill's.
- **Never consolidate the generator's output** — if `muggle-remote-test-case-generate-from-prompt` returns N micro-tests, accept all N; never merge them into fewer test cases, even if "the plan" says 4 UC / 4 TC.
- **Never skip the generate→review cycle** — always present generated test cases to the user before calling `muggle-remote-test-case-create`, even when you're confident. "I'll skip the review and create directly" is always wrong.
- **Never ask for Electron launch approval before each run** — the user picking Local mode is the approval. Don't prompt "Ready to launch Electron?" before execution; just run.
- **Never silently drop test cases** — log failures and continue, then report them
- **Never guess the URL** — always ask the user for localhost or preview URL
- **Always publish before opening browser** — the dashboard needs the published data to show results
- **Delegate PR posting to `muggle-pr-visual-walkthrough`** — never inline the walkthrough markdown or call `gh pr comment` directly from this skill; ask the user and hand off
- **Can be invoked at any state** — if the user already has a project or use cases set up, skip to the relevant step rather than re-doing everything
