---
name: muggle-test
description: "Change-driven E2E acceptance testing with Muggle AI: detect the user's recent code changes (local diff or a PR), map them to affected user flows, run real-browser tests on localhost or a preview/staging URL, publish results, and post a screenshot summary to the PR. Use whenever the user wants to test, validate, or regression-test their own in-progress changes or work — \"make sure I didn't break anything\", \"did my recent commits break any user flows?\", \"test before I push\" — especially as the acceptance gate before opening or merging a PR. The defining signal is change-driven validation tied to a commit, push, PR, or merge. For one specific named feature/flow use muggle-test-feature-local; not for importing existing tests, configuring preferences, or replaying a single named script."
---

# Muggle Test — Change-Driven E2E Acceptance Router

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-test"`.

A router skill that detects code changes, resolves impacted test cases, executes them locally or remotely, reads the cloud results from the Muggle AI dashboard (local runs are published by the studio during execution; remote runs publish cloud-side), and posts E2E acceptance summaries to the PR. The user can invoke this at any moment, in any state.

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
| `autoSelectLocalHost` | execute-local | Reuse last-used local dev server URL for this repo |
| `autoDetectChanges` | 2 | Scan local git changes and map to affected test cases |
| `defaultExecutionMode` | 1 | Default to local or remote test execution |
| `showElectronBrowser` | execute-local | Show the Electron browser window during local test execution (vs. run headless) |
| `postPRVisualWalkthrough` | 9 | Post visual walkthrough to PR after results are available |
| `autoCreatePR` | 9 (if no PR) | Auto-create the PR when posting the walkthrough has no PR to target |
| `autoWatchPR` | 9.5 (if a PR exists) | Start a `muggle-pr-followup` watcher on the PR after the run |

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
3. Materialize the PR branch in a dedicated worktree per [`_shared/pr-branch-worktree.md`](../_shared/pr-branch-worktree.md). Use that worktree path as the `cwd` for the rest of the run (including the `cwd` parameter on local execute tools).

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

1. Call `muggle-remote-auth-status`. Three states: **valid** (`authenticated: true`), **expired** (`authenticated: false` + `isExpired: true`, `email` still present), **absent** (`authenticated: false`, no `email`).
2. **Valid OR expired** (any stored identity) → gate `autoLogin` (per `preference-gates/README.md`). An expired token is NOT a reason to silently re-login the same account — surface the switch choice:
   - `always` → reuse if valid; if expired, re-login the **same** account (`muggle-remote-auth-login`, then `muggle-remote-auth-poll`).
   - `never` → `muggle-remote-auth-login` with `forceNewSession: true`, then `muggle-remote-auth-poll`.
   - `ask` → run Picker 1 from `preference-gates/autoLogin.md` via `AskUserQuestion`; map the answer back to one of the actions above.
3. **Absent** (no stored identity) → `muggle-remote-auth-login` directly, then `muggle-remote-auth-poll`.
4. If login pending → call `muggle-remote-auth-poll`.

**Account-switch caveat (`never` / "Switch account").** The device flow has no `prompt=select_account`; switching relies on `forceNewSession` first clearing the Auth0 session via `/v2/logout?returnTo=<device-activation URL>`. That redirect only works if the activation URL is in the app's Auth0 *Allowed Logout URLs* — otherwise the browser shows an Auth0 error page and the session is silently reused. If that happens, tell the user to complete login in a **fresh incognito window** (no live SSO session) so Auth0 presents an account login.

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

## Step 7: Execute

### Fetch test case details (both modes)

Hydrate every selected test case **once**, before dispatch: issue **all** `muggle-remote-test-case-get` calls in parallel (single message, multiple tool calls). Both paths consume the result — never re-fetch inside a path.

### Dispatch by mode

Run the path matching the mode confirmed in Step 1. Each path owns its own process and returns a **uniform runs list** — `[{ testCaseId, mode, runId | runtimeId, status, viewUrl? }]` — that Steps 7C–10 consume mode-agnostically.

- **Mode A (Local)** → [`execute-local.md`](execute-local.md). Inputs: the hydrated test cases, per-case `mode` from Step 6f, and `cwd` (the PR-branch worktree from Step 2 if one exists, else the repo root).
- **Mode B (Remote)** → [`execute-remote.md`](execute-remote.md). Inputs: the hydrated test cases, per-case `mode` from Step 6f, `projectId` / `useCaseId`.

## Step 7C: Route every failed run through the debug path

For every run with `status: "failed"` (or any non-passing terminal state) returned by Step 7 (either path), route through [`_shared/debug-failed-run.md`](../_shared/debug-failed-run.md). This is **mandatory** — a failure is never reported without it. The debug path gathers evidence (attempted steps + reasoning + screenshot), diagnoses via [`_shared/failure-mode-handling.md`](../_shared/failure-mode-handling.md) (§B replay / §C regen), shows the debug card, and presents the guaranteed selection in which **"give feedback & rerun"** is always an option and "skip" is never the default.

Pass it per failed run: the `runId` (local) or workflow runtime id (remote), the `mode` that failed, `testCaseId`, `projectId`, and the execution handle (local: [`execute-local.md`](execute-local.md); remote: [`execute-remote.md`](execute-remote.md)) so a rerun re-enters the same path. Process failures one at a time so the user isn't drowning in pickers.

## Step 8: Open Results in Browser

After execution, open the Muggle AI dashboard so the user can inspect results and screenshots. The studio published every local run during execution, so each run result already carries its `viewUrl` (read it from `muggle-local-run-result-get`). Key off the uniform runs list:

- **Runs carry a `viewUrl` and there are ≤3** — open each:
  ```bash
  open "https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/scripts?modal=script-details&testCaseId={testCaseId}"
  ```
- **Otherwise** (more than 3 runs, or a run with no `viewUrl`) — open the project runs page:
  ```bash
  open "https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/runs"
  ```

Tell the user:
> "I've opened the Muggle AI dashboard in your browser — you can see the test results, step-by-step screenshots, and action scripts there."

## Step 9: Offer to Post Visual Walkthrough to PR

After reporting results:

1. Fire [`postPRVisualWalkthrough`](../muggle-preferences/preference-gates/postPRVisualWalkthrough.md). On skip → Step 9.5.
2. `gh pr view --json number,title,url 2>/dev/null` — find the PR.
3. If no PR: fire [`autoCreatePR`](../muggle-preferences/preference-gates/autoCreatePR.md). On skip → Step 9.5.
4. Assemble the `E2eReport` — see [`../muggle-pr-visual-walkthrough/e2e-report-assembly.md`](../muggle-pr-visual-walkthrough/e2e-report-assembly.md). Include all runs from Step 7 (passed and failed).
5. Invoke [`../muggle-pr-visual-walkthrough/SKILL.md`](../muggle-pr-visual-walkthrough/SKILL.md) Mode A with the `E2eReport`.

## Step 9.5: Offer to watch the PR for review follow-ups

Once a PR exists for this work, offer to keep watching its review thread.

1. Identify the PR — reuse the `gh pr view --json number,title,url` result from Step 9 if available, else run it now. No PR (none exists, none created) → Step 10.
2. Fire [`autoWatchPR`](../muggle-preferences/preference-gates/autoWatchPR.md) with `{pr}` = `<owner>/<repo>#<number>`. On skip → Step 10.
3. On proceed: start the watcher reusing this run's context so it never re-prompts —
   - Seed the `muggle-pr-followup` session slot and dispatch its loop per the stage-8 seeding in [`../do/open-prs/forward.md`](../do/open-prs/forward.md) (default slug `<repo>-pr<number>`).
   - Additionally write `state.md`'s `## Pre-flight answers` block from the context resolved this run — validation strategy, local URL, project, credentials, auth, working tree — per [`../_shared/resolve-e2e-validation-context.md`](../_shared/resolve-e2e-validation-context.md#persisted-fields). Strategy = `local-e2e` (local run), `staging-replay` (remote), or `unit-only`/`skip` if no E2E ran.

The `/mprfollowup` shortcut starts the same watcher manually at any time.

## Step 10: Offer feedback on a clean pass

Failures already got a guaranteed feedback-&-rerun offer in Step 7C's debug path — don't re-ask for them here.

This step is only for a run that **passed** but the user flags as off (a misclick, wrong element, a summary that doesn't match intent). When that happens, use `AskUserQuestion`:
- **Yes — give feedback** → invoke the `muggle-feedback` skill via the `Skill` tool, passing the run's `runId` (local) or `testScriptId` (remote) as anchor context so the submit flow opens with the correct script already loaded.
- **No — skip**

Skip silently if nothing looked off.

## Non-negotiables

Each rule below is covered in-step above; these are the ones this skill most often violates, kept here as reinforcement:

- **Test-case shape** — never skip the generate→review cycle, never consolidate the generator's micro-tests, one atomic behavior per test case. Creating test cases directly or merging the generator's output is the single most frequent mistake.
- **Every failure routes through the debug path** — no failed run is summarized-and-dropped. Step 7C → [`_shared/debug-failed-run.md`](../_shared/debug-failed-run.md) is mandatory, "give feedback & rerun" is always offered, and "skip" is never the default.
- **Confirm intent before acting** — local vs remote; never guess the localhost/preview URL.
- **PR URLs run in a dedicated worktree** — never switch the user's main checkout; pass that worktree as `cwd`.
- **Every selection uses `AskUserQuestion`** — never ask the user to type a number; the user picks the project (never auto-select).
- **Parallelize independent cloud jobs**; the only sequential loop is local Electron execution (one browser).
- **Read cloud refs off the run result** (the studio published during execution) and delegate PR posting to `muggle-pr-visual-walkthrough` — never inline the walkthrough or call `gh pr comment` here.

Phase→tool map and multi-agent (acceptance-tester) dispatch: [`reference.md`](reference.md).
