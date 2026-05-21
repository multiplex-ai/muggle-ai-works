---
name: muggle-test
description: "Run change-driven E2E acceptance testing using Muggle AI — detects local code changes, maps them to use cases, and generates test scripts either locally (real browser on localhost) or remotely (cloud execution on a preview/staging URL). Publishes results to Muggle Test dashboard, opens them in the browser, and posts E2E acceptance summaries with screenshots to the PR. Use this skill whenever the user wants to test their changes, run E2E acceptance tests on recent work, validate what they've been working on, or check if their code changes broke anything. Triggers on: 'test my changes', 'run tests on my changes', 'acceptance test my work', 'check my changes', 'validate my changes', 'test before I push', 'make sure my changes work', 'regression test my changes', 'test on preview', 'test on staging'. This is the go-to skill for change-driven E2E acceptance testing — it handles everything from change detection to test execution to result reporting."
---

# Muggle Test — Change-Driven E2E Acceptance Router

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-test"`.

A router skill that detects code changes, resolves impacted test cases, executes them locally or remotely, publishes results to the Muggle AI dashboard, and posts E2E acceptance summaries to the PR. The user can invoke this at any moment, in any state.

## UX Guidelines — Minimize Typing

**Every selection-based question MUST use the `AskUserQuestion` tool** (or the platform's equivalent structured selection tool). Never ask the user to "reply with a number" in a plain text message — always present clickable options.

- **Selections** (project, use case, test case, mode, approval): Use `AskUserQuestion` with labeled options the user can click.
- **Multi-select** (use cases, test cases): Use `AskUserQuestion` with `allow_multiple: true`.
- **Free-text inputs** (URLs, descriptions): Only use plain text prompts when there is no finite set of options. Even then, offer a detected/default value when possible.
- **Batch related questions**: If two questions are independent, present them together in a single `AskUserQuestion` call rather than asking sequentially.
- **Parallelize job-creation calls**: Whenever you're kicking off N independent cloud jobs — creating multiple use cases, generating/creating multiple test cases, fetching details for multiple test cases, starting multiple remote workflows, publishing multiple local runs, or fetching per-step screenshots for multiple runs — issue all N tool calls in a single message so they run in parallel. Never loop them sequentially unless there is a real ordering constraint (e.g. a single local Electron browser that can only run one test at a time).

## Test Case Design: One Atomic Behavior Per Test Case

Every test case verifies exactly **one** user-observable behavior. Never bundle multiple concerns, sequential flows, or bootstrap/setup into a single test case — even if you think it would be "cleaner" or "more efficient."

**Ordering, dependencies, and bootstrap are Muggle Test's service responsibility, not yours.** Muggle Test's cloud handles test case dependencies, prerequisite state, and execution ordering. Your job is to describe the *atomic behavior to verify* — never the flow that gets there.

- ❌ Wrong: one test case that "signs up, logs in, navigates to the detail modal, verifies icon stacking, verifies tab order, verifies history format, and verifies reference layout."
- ✅ Right: four separate test cases — one per verifiable behavior — each with instruction text like "Verify the detail modal shows stacked pair of icons per card" with **no** signup / login / navigation / setup language.

**Never bake bootstrap into a test case description.** Signup, login, seed data, prerequisite navigation, tear-down — none of these belong inside the test case body. Write only the verification itself. The service will prepend whatever setup is needed based on its own dependency graph.

**Never consolidate the generator's output.** When `muggle-remote-test-case-generate-from-prompt` returns N micro-tests from a single prompt, that decomposition is the authoritative one. Do not "merge them into 1 for simplicity," do not "rewrite them to share bootstrap," do not "collapse them to match a 4 UC / 4 TC plan." Accept what the generator gave you.

**Never skip the generate→review cycle.** Even when you are 100% confident about the right shape, always present the generated test cases to the user before calling `muggle-remote-test-case-create`. "I'll skip the generate→review cycle and create directly" is a sign you're about to get it wrong.

## Preferences

Gates run per `preference-gates/README.md`.

| Preference | Step | Decision it gates |
|------------|------|-------------------|
| `autoLogin` | 3 | Reuse saved credentials when auth is required |
| `autoSelectProject` | 4 | Reuse last-used Muggle Test project for this repo |
| `autoSelectLocalHost` | 7A | Reuse last-used local dev server URL for this repo |
| `autoDetectChanges` | 2 | Scan local git changes and map to affected test cases |
| `defaultExecutionMode` | 1 | Default to local or remote test execution |
| `autoPublishLocalResults` | 7A | Upload local results to Muggle Test cloud after run |
| `showElectronBrowser` | 7A | Show the Electron browser window during local test execution (vs. run headless) |
| `postPRVisualWalkthrough` | 9 | Post visual walkthrough to PR after results are available |
| `autoCreatePR` | 9 (if no PR) | Auto-create the PR when posting the walkthrough has no PR to target |

## Step 1: Confirm Scope of Work (Always First)

Parse the user's query and explicitly confirm their expectation. There are exactly two modes:

### Mode A: Local Test Generation (default for PRs)
> Test impacted use cases/test cases against **localhost** using the Electron browser.
>
> Execution tool: `muggle-local-execute-test-generation`

Signs the user wants this: mentions "localhost", "local", "my machine", "dev server", "my changes locally", or just "test my changes" in a repo context. **Also: passing a GitHub PR/issue/repo URL (`github.com/<org>/<repo>/pull/<n>`) defaults to Local mode** — PR review almost always means checking out the branch and validating against the dev server, not testing the PR's preview deployment.

### Mode B: Remote Test Generation
> Ask Muggle Test's cloud to generate test scripts against a **preview/staging URL**.
>
> Execution tool: `muggle-remote-workflow-start-test-script-generation`

Signs the user wants this: mentions "preview", "staging", "deployed", "preview URL", "test on preview", "test the deployment", or provides an actual **deployed** preview/staging URL (e.g. `*.vercel.app`, `staging.foo.com`, custom preview domains). GitHub PR URLs do **not** count — see Mode A.

### Confirming (gated by `defaultExecutionMode`)

Gate `defaultExecutionMode` (per `preference-gates/README.md`). Uses `local`/`remote`/`ask`.
- `local` → proceed in Local mode.
- `remote` → proceed in Remote mode.
- `ask` + intent clear → skip Picker 1, confirm one-shot then skip Picker 2.
- `ask` + ambiguous → run Picker 1 from gate file.

Only proceed after selection.

## Step 2: Detect Local Changes (gated by `autoDetectChanges`)

Gate `autoDetectChanges` (per `preference-gates/README.md`):
- `always` → run the scan and proceed to analysis below.
- `never` → ask "What would you like to test?" then jump to Step 3.
- `ask` → run Picker 1 from `preference-gates/autoDetectChanges.md` via `AskUserQuestion`; map the answer back to one of the actions above.

### Analysis (when scan is enabled)

Analyze the changes to understand what's impacted. Two sources, picked by what the user passed:

**Working directory** (default):
1. Run `git status` and `git diff --stat` for an overview
2. Run `git diff` (or `git diff --cached` if staged) to read actual diffs

**PR URL** (user passed `github.com/<org>/<repo>/pull/<n>`):
1. `gh pr diff <n> --repo <org>/<repo> --name-only` for the changed file list
2. `gh pr diff <n> --repo <org>/<repo>` for the actual diff
3. The repo lives at a sibling path (e.g. `C:\Users\stan4\Github\<repo>`) — `cd` into it and verify the PR branch is checked out before running tests; if not, ask the user to check it out (or offer to do it).

Either way:
1. Identify impacted feature areas:
   - Changed UI components, pages, routes
   - Modified API endpoints or data flows
   - Updated form fields, validation, user interactions
2. Produce a concise **change summary** — a list of impacted features

Present:
> "Here's what changed: [list]. I'll scope E2E acceptance testing to these areas."

If no changes detected (clean tree), tell the user and ask what they want to test.

## Step 3: Authenticate

1. Call `muggle-remote-auth-status`
2. If **authenticated and not expired** → gate `autoLogin` (per `preference-gates/README.md`):
   - `always` → reuse saved session.
   - `never` → `muggle-remote-auth-login` with `forceNewSession: true`, then `muggle-remote-auth-poll`.
   - `ask` → run Picker 1 from `preference-gates/autoLogin.md` via `AskUserQuestion`; map the answer back to one of the actions above.
3. If **not authenticated or expired** → call `muggle-remote-auth-login`
4. If login pending → call `muggle-remote-auth-poll`

If auth fails repeatedly, suggest: `muggle logout && muggle login` from terminal.

## Step 4: Select Project (gated by `autoSelectProject`)

A **project** is where all your test results, use cases, and test scripts are grouped on the Muggle AI dashboard. Pick the project that matches what you're working on.

The per-repo cache lives at `<cwd>/.muggle-ai/last-project.json` (managed via the `muggle-local-last-project-get` / `muggle-local-last-project-set` MCP tools). Look for the `Muggle Test Last Project: id=… url=… name="…"` line in session context — if present, that's this repo's cached pick.

Gate `autoSelectProject` (per `preference-gates/README.md`). Cache: `Muggle Test Last Project` session line.
- `always` + cache → use cached `projectId`, skip to Step 5. No cache → fall through to `ask`.
- `never` → full project list; skip Picker 2.
- `ask` → project list picker (see gate file for spec + Picker 2 override). Skip Picker 2 if "Create new project".

### Logic

1. Resolve the chosen project per the gate above.
2. Call `muggle-remote-project-list` only when the gate doesn't already give a `projectId` from the cache.
3. **Wait for the user to explicitly choose** when presenting the picker — do NOT auto-select based on repo name or URL matching.
4. **If user chooses "Create new project"**:
   - Ask for `projectName`, `description`, and the production/preview URL
   - Call `muggle-remote-project-create`

Store the `projectId` only after user confirms (or after silent reuse from the cache).

## Step 5: Select Use Case (Best-Effort Shortlist)

### 5a: List existing use cases
Call `muggle-remote-use-case-list` with the project ID.

### 5b: Best-effort match against the change summary

Using the change summary from Step 2, pick the use cases whose title/description most plausibly relate to the impacted areas. Produce a **short shortlist** (typically 1–5) — don't try to be exhaustive, and don't dump the full project list on the user. A confident best-effort match is the goal.

If nothing looks like a confident match, fall back to asking the user which use case(s) they have in mind.

### 5c: Present the shortlist for confirmation

Use `AskUserQuestion` with `allow_multiple: true`:

Prompt: "These use cases look most relevant to your changes — confirm which to test:"

- Pre-check the shortlisted items so the user can accept with one click
- Include "Pick a different use case" to reveal the full project list
- Include "Create new use case" at the end

### 5d: If user picks "Pick a different use case"
Re-present the full list from 5a via `AskUserQuestion` with `allow_multiple: true`, then continue.

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

Use `AskUserQuestion` with `allow_multiple: true`:

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

Use `AskUserQuestion` to confirm: "You selected [N] test case(s): [list titles]. Ready to proceed?"
- Option 1: "Yes, run them"
- Option 2: "No, let me re-select"

Wait for user confirmation before moving to execution.

### 6f: Classify execution mode per test case (replay vs regen)

For each selected test case, decide whether the run should be a **replay** of an existing script or a fresh **regen**, using the rules in [`_shared/failure-mode-handling.md`](../_shared/failure-mode-handling.md) section A. Inputs: the change summary from Step 2, the test case body, and the result of `muggle-remote-test-script-list` for that test case (last passing timestamp + whether any replayable script exists).

Per test case, fire one `muggle-local-telemetry-event-emit` with `eventType: "pre-execution-classification"` capturing the picked mode, the rule that fired, and the matched changed-file paths.

Then show the per-case decision in one `AskUserQuestion`:

> "Here's how I plan to run each test case — replay reuses the saved script, regen rebuilds it from scratch:
> - [REPLAY] Login with valid creds — selectors look unchanged
> - [REGEN] Sign up with valid email — last passed > 30 days ago
> - [REGEN] Add to cart — `app/cart/page.tsx` changed (UI/markup)"
>
> Options: "Looks good — proceed", "Override one or more", "Cancel"

If the user picks "Override one or more", let them flip the mode for any test case via a second multi-select `AskUserQuestion`. Emit a follow-up `pre-execution-classification` event with `userAction` set whenever the user overrides.

## Step 7A: Execute — Local Mode

### Pre-flight question — Local URL (gated by `autoSelectLocalHost`)

Skill responsibilities (the rest is in `preference-gates/autoSelectLocalHost.md`):
- **Read the cache**: `Muggle Test Last Host: <url>` session-context line, or `muggle-local-last-host-get`. Pass as `{lastHost}` substitution.
- **Auto-detect a suggested URL**: `lsof -iTCP -sTCP:LISTEN -nP | grep -E ':(3000|3001|4200|5173|8080)'`. Pass as `{suggestedHost}`.
- **Save the cache**: call `muggle-local-last-host-set` after the user picks (the gate file requires this on every pick).

Gate `autoSelectLocalHost` per `preference-gates/README.md` + `preference-gates/autoSelectLocalHost.md`.

### Pre-flight visibility (gated by `showElectronBrowser`)

Gate `showElectronBrowser` (per `preference-gates/README.md`). Resolve once; apply same `showUi` to every test case.
- `always` → omit `showUi` (defaults visible).
- `never` → pass `showUi: false`.
- `ask` → run Picker 1 from `preference-gates/showElectronBrowser.md` via `AskUserQuestion`; map the answer back to one of the actions above.

### Fetch test case details (in parallel)

Before execution, fetch full test case details for all selected test cases by issuing **all** `muggle-remote-test-case-get` calls in parallel (single message, multiple tool calls).

### Determine `freshSession` per test case

Before executing each test case, inspect its content (title, goal, instructions, preconditions) for signals that it requires a **clean browser state** — no prior cookies, localStorage, or logged-in session. Set `freshSession: true` when the test case involves any of:

- **Registration / sign-up** — creating a new account
- **Login / authentication** — verifying the login flow itself (not a test that merely *uses* login as a prerequisite)
- **Cookie consent / GDPR banners** — verifying first-visit consent prompts
- **Onboarding flows** — first-time user experiences that only appear on a fresh session

If none of the above apply, omit `freshSession` (defaults to `false`, preserving any existing session state). Evaluate this per test case — in a batch, some may need it and others may not.

### Run sequentially (Electron constraint)

Execution itself **must** be sequential because there is only one local Electron browser. For each test case, in the order chosen, branch on the mode picked in Step 6f:

**Regen-mode test case:**
1. Call `muggle-local-execute-test-generation`:
   - `testCase`: Full test case object from the parallel fetch above
   - `localUrl`: User's local URL from the pre-flight question
   - `showUi`: from the `showElectronBrowser` resolution — omit (default visible) for `always`, pass `false` for `never`
   - `freshSession`: `true` if the test case requires a clean browser state (see above), omit otherwise
2. Store the returned `runId` and tag the result `mode: "regen"`.

**Replay-mode test case:**
1. Fetch the action script: `muggle-remote-test-script-get` (latest replayable script id) → `muggle-remote-action-script-get` (full `actionScript` — use as-is, never edit). For batches, fan these calls out in parallel before the sequential execution loop begins.
2. Call `muggle-local-execute-replay`:
   - `testScript`: from `muggle-remote-test-script-get`
   - `actionScript`: from `muggle-remote-action-script-get`
   - `localUrl`, `showUi`, `freshSession`: same resolution as regen
3. Store the returned `runId` and tag the result `mode: "replay"`.

If a run fails, log it and continue to the next — do not abort the batch. Failures are routed through Step 7C's post-failure handler after the batch completes.

### Collect results (in parallel)

For every `runId`, issue all `muggle-local-run-result-get` calls in parallel. Extract: status, duration, step count, `artifactsDir`.

### Publish each run to cloud (gated by `autoPublishLocalResults`)

Gate `autoPublishLocalResults` (per `preference-gates/README.md`):
- `always` → proceed to publish logic below.
- `never` → skip to report summary; tell user Steps 8/9 and per-step screenshots are unavailable without publishing.
- `ask` → run Picker 1 from `preference-gates/autoPublishLocalResults.md` via `AskUserQuestion`; map the answer back to one of the actions above.

### Publish logic (when publishing is enabled)

For every completed run, issue all `muggle-local-publish-test-script` calls in parallel (single message, multiple tool calls):
- `runId`: The local run ID
- `cloudTestCaseId`: The cloud test case ID

This returns:
- `viewUrl`: Direct link to view this test run on the Muggle AI dashboard
- `testScriptId`, `actionScriptId`, `workflowRuntimeId`

Store every `viewUrl` — these are used in the next steps.

### Report summary

```
Test Case                  Status    Duration   Steps   View Steps on Muggle AI
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

Branch each test case on the mode chosen in Step 6f, then issue **all** workflow-start calls in parallel — never loop them sequentially. Mix regen and replay starts in the same parallel batch.

**Regen-mode test case** — `muggle-remote-workflow-start-test-script-generation`:

- `projectId`: The project ID
- `useCaseId`: The use case ID
- `testCaseId`: The test case ID
- `name`: `"muggle-test: {test case title}"`
- `url`: The preview/staging URL
- `goal`: From the test case
- `precondition`: From the test case (use `"None"` if empty)
- `instructions`: From the test case
- `expectedResult`: From the test case

**Replay-mode test case** — `muggle-remote-workflow-start-test-script-replay` against the latest replayable script for that test case (resolve via `muggle-remote-test-script-list` if not already in hand from Step 6f). Tag results with `mode: "replay"` so Step 7C can route failures correctly.

Store each returned workflow runtime ID along with its mode tag.

### Monitor and report (in parallel)

Issue all `muggle-remote-wf-get-ts-gen-latest-run` calls in parallel, one per runtime ID.

```
Test Case                  Workflow Status   Runtime ID
────────────────────────────────────────────────────────
Login with valid creds     RUNNING           rt-abc123
Login with invalid creds   COMPLETED         rt-def456
Checkout flow              QUEUED            rt-ghi789
```

## Step 7C: Route failures through the failure-mode handler

For every run with `status: "failed"` (or any non-passing terminal state) from 7A or 7B, follow [`_shared/failure-mode-handling.md`](../_shared/failure-mode-handling.md):

- **Replay-mode failures** — section B (buckets: `infra` / `stale-script` / `product-defect`).
- **Regen-mode failures** — section C (buckets: `transient` / `infra` / `agent-course` / `product-uxux`).

For each failed run:
1. Read the run with `muggle-local-run-result-get` (local) or `muggle-remote-wf-get-ts-gen-latest-run` / `muggle-remote-wf-get-ts-replay-latest-run` (remote) and extract signals per the heuristics in the shared doc.
2. Emit `replay-failure-classified` or `regen-failure-classified` via `muggle-local-telemetry-event-emit` **before** asking the user.
3. Present the recommended action via `AskUserQuestion` along with the alternatives the shared doc lists for that bucket.
4. After the user picks, emit the matching `*-resolved` event with `userAction` set to what they chose.

Process failures one at a time so the user isn't drowning in pickers — but emit telemetry per failure regardless.

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

After reporting results:

1. Fire [`postPRVisualWalkthrough`](../muggle-preferences/preference-gates/postPRVisualWalkthrough.md). On skip → Step 10.
2. `gh pr view --json number,title,url 2>/dev/null` — find the PR.
3. If no PR: fire [`autoCreatePR`](../muggle-preferences/preference-gates/autoCreatePR.md). On skip → Step 10.
4. Assemble the `E2eReport` — see [`../muggle-pr-visual-walkthrough/e2e-report-assembly.md`](../muggle-pr-visual-walkthrough/e2e-report-assembly.md). Include all runs from Step 7A (passed and failed).
5. Invoke [`../muggle-pr-visual-walkthrough/SKILL.md`](../muggle-pr-visual-walkthrough/SKILL.md) Mode A with the `E2eReport`.

## Step 10: Offer feedback on failures

After the report is complete, if **any** test in the run had a `failed` or unexpected status (or the user verbally flags something looked off), suggest the feedback skill:

> "Looks like `<N>` test(s) didn't go as expected. Want to leave feedback on what should've happened? It triggers regeneration on the affected scripts."

Use `AskUserQuestion`:
- **Yes — give feedback** → invoke the `muggle-feedback` skill via the `Skill` tool. Pass the failed run's `runId` (local) or `testScriptId` (remote) as anchor context so the submit flow opens with the correct script already loaded.
- **No — skip**

This is a suggestion, not automatic invocation. Skip silently if every test passed cleanly.

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
| Execute (regen) | `muggle-local-execute-test-generation` | Local |
| Execute (replay) | `muggle-local-execute-replay` | Local |
| Replay action script fetch | `muggle-remote-test-script-get`, `muggle-remote-action-script-get` | Local replay |
| Execute (regen) | `muggle-remote-workflow-start-test-script-generation` | Remote |
| Execute (replay) | `muggle-remote-workflow-start-test-script-replay` | Remote |
| Failure-mode telemetry | `muggle-local-telemetry-event-emit` | Both |
| Results | `muggle-local-run-result-get` | Local |
| Results | `muggle-remote-wf-get-ts-gen-latest-run`, `muggle-remote-wf-get-ts-replay-latest-run` | Remote |
| Publish | `muggle-local-publish-test-script` | Local |
| Per-step screenshots (for walkthrough) | `muggle-remote-test-script-get` | Both |
| Browser | `open` (shell command) | Both |
| PR walkthrough | `muggle-pr-visual-walkthrough` (shared skill) | Both |

## Guardrails

- **Always confirm intent first** — never assume local vs remote without asking
- **User MUST select project** — present clickable options via `AskUserQuestion`, wait for explicit choice, never auto-select
- **Best-effort shortlist use cases** — use the change summary to narrow the list to the most relevant 1–5 use cases and pre-check them; never dump every use case in the project on the user. Always leave an escape hatch to reveal the full list.
- **Best-effort shortlist test cases** — same idea: pre-check the test cases most relevant to the change summary; never enumerate every test case attached to a use case. Always leave an escape hatch to reveal the full list.
- **Use `AskUserQuestion` for every selection** — never ask the user to type a number; always present clickable options
- **Auto-detect localhost URL when possible**; only fall back to free-text when nothing is listening on a common port
- **Parallelize independent cloud jobs** — when creating N use cases, generating/creating N test cases, fetching N test case details, starting N remote workflows, polling N workflow runtimes, publishing N local runs, or fetching N per-step test scripts, issue all N calls in a single message so they fan out in parallel. The only tolerated sequential loop is local Electron execution (one browser, one test at a time). For use case creation specifically, use the native batch form of `muggle-remote-use-case-create-from-prompts` (all descriptions in one `instructions` array) instead of parallel calls.
- **One atomic behavior per test case** — every test case verifies exactly one user-observable behavior. Never bundle signup/login/navigation/bootstrap/teardown into a test case body. Ordering and dependencies are Muggle Test's service responsibility, not the skill's.
- **Never consolidate the generator's output** — if `muggle-remote-test-case-generate-from-prompt` returns N micro-tests, accept all N; never merge them into fewer test cases, even if "the plan" says 4 UC / 4 TC.
- **Never skip the generate→review cycle** — always present generated test cases to the user before calling `muggle-remote-test-case-create`, even when you're confident. "I'll skip the review and create directly" is always wrong.
- **Never silently drop test cases** — log failures and continue, then report them
- **Never guess the URL** — always ask the user for localhost or preview URL
- **Always publish before opening browser** — the dashboard needs the published data to show results
- **Delegate PR posting to `muggle-pr-visual-walkthrough`** — never inline the walkthrough markdown or call `gh pr comment` directly from this skill; ask the user and hand off
- **Can be invoked at any state** — if the user already has a project or use cases set up, skip to the relevant step rather than re-doing everything

## Agent Dispatch

When used in a multi-agent team (e.g., muggle-ai-teams), this skill is available through the **acceptance-tester** agent at `plugin/agents/acceptance-tester.md`. Orchestrators can dispatch it via `Agent()` instead of invoking this skill directly. The agent wraps this skill and four others (muggle-test-import, muggle-preferences, muggle-repair, muggle-status) and returns structured test results with blocking issues and suggested fixes for coding agents to act on.
