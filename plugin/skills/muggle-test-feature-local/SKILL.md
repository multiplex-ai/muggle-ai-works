---
name: muggle-test-feature-local
description: Run a real-browser end-to-end (E2E) acceptance test against localhost to verify a feature works correctly — signup flows, checkout, form validation, UI interactions, or any user-facing behavior. Launches a browser that executes test steps and captures screenshots. Use this skill whenever the user asks to test, validate, or verify their web app, UI changes, user flows, or frontend behavior on localhost or a dev server — even if they don't mention 'muggle' or 'E2E' explicitly.
---

# Muggle Test Feature Local

**Goal:** Run or generate an end-to-end test against a **local URL** using Muggle's Electron browser.

| Scope | MCP tools |
| :---- | :-------- |
| Cloud (projects, cases, scripts, auth) | `muggle-remote-*` |
| Local (Electron run, publish, results) | `muggle-local-*` |
| Create new entities (preview / create) | `muggle-remote-project-create`, `muggle-remote-use-case-prompt-preview`, `muggle-remote-use-case-create-from-prompts`, `muggle-remote-test-case-generate-from-prompt`, `muggle-remote-test-case-create` |

The local URL only changes where the browser opens; it does not change the remote project or test definitions.

## UX Guidelines — Minimize Typing

**Every selection-based question MUST use the `AskQuestion` tool** (or the platform's equivalent structured selection tool). Never ask the user to "reply with a number" in a plain text message — always present clickable options.

- **Selections** (project, use case, test case, script): Use `AskQuestion` with labeled options the user can click.
- **Free-text inputs** (URLs, descriptions): Only use plain text prompts when there is no finite set of options. Even then, offer a detected/default value when possible.

## Preferences

User preferences are injected by the SessionStart hook into a `Muggle Preferences` line in session context (key=value pairs). Resolution: defaults → `~/.muggle-ai/preferences.json` (global) → `<repo>/.muggle-ai/preferences.json` (project). Treat absent prefs as `ask`.

**At every preference-gated step below**, apply this rule:

- `always` → perform the auto-action silently. **Skip both pickers.**
- `never` → skip the action silently. **Skip both pickers.**
- `ask` (or absent) → run the **2-picker flow**:
  1. **Picker 1** (`AskQuestion`): the substantive choice for this step. Each option maps to either `always` or `never`.
  2. **Picker 2** (`AskQuestion`): `"Remember this? Next time I'll automatically <action description> without asking. (preference: <key> = <value>)"` with options:
     - "Yes, save it"
     - "No, just for this run"
  3. On **"Yes, save it"** → call `muggle-local-preferences-set` with `key`, the value chosen in Picker 1, `scope: "global"`.

The `<action description>` and the substantive options are step-specific — see each gated step below.

| Preference | Step | Decision it gates |
|------------|------|-------------------|
| `autoLogin` | 1 | Reuse saved credentials when auth is required |
| `autoSelectProject` | 2 | Reuse last-used Muggle project for this repo |
| `showElectronBrowser` | 7 | Show Electron browser window during local E2E tests |
| `openTestResultsAfterRun` | 8 | Open results page on Muggle dashboard after run |

## Workflow

### 1. Auth (gated by `autoLogin`)

- `muggle-remote-auth-status`
- If **authenticated**, apply the `autoLogin` gate (see Preferences for the full 2-picker flow):
  - **`autoLogin = always`** → continue with the saved session silently. Skip both pickers.
  - **`autoLogin = never`** → call `muggle-remote-auth-login` with `forceNewSession: true`, then `muggle-remote-auth-poll`. Skip both pickers.
  - **`autoLogin = ask` (or absent)** → run the 2-picker flow:
    - **Picker 1**: `"You're logged in as {email}. Continue with this account?"`
      - "Yes, continue" → maps to `autoLogin = always`. Proceed with the saved session.
      - "No, switch account" → maps to `autoLogin = never`. Call `muggle-remote-auth-login` with `forceNewSession: true`, then `muggle-remote-auth-poll`.
    - **Picker 2**: `"Remember this? Next time I'll automatically <reuse your saved login | force a fresh login> without asking. (preference: autoLogin = <always|never>)"`
      - "Yes, save it" → call `muggle-local-preferences-set` with `key: "autoLogin"`, `value: "<always|never>"`, `scope: "global"`.
      - "No, just for this run" → continue without saving.
- If **not signed in or expired**: call `muggle-remote-auth-login` then `muggle-remote-auth-poll`.
  Do not skip or assume auth.

### 2. Targets (user must confirm)

The per-repo project cache lives at `<cwd>/.muggle-ai/last-project.json` (via the `muggle-local-last-project-get` / `muggle-local-last-project-set` MCP tools). Look for `Muggle Last Project: id=… url=… name="…"` in session context.

For project selection: apply the `autoSelectProject` gate (see Preferences):
- **`autoSelectProject = always`** with the `Muggle Last Project` line present → use that `projectId` silently. Skip both pickers and skip to use case selection. If no cache line is present, fall through to `ask`.
- **`autoSelectProject = never`** → always present the full project list; skip Picker 2 (memory).
- **`autoSelectProject = ask` (or absent)** → present the full project list (Picker 1), then offer Picker 2 only after a successful pick of an existing project (skip Picker 2 if user picked "Create new project"):
  - Picker 2: `"Remember this? Next time I'll automatically reuse this project for this repo without asking. (preference: autoSelectProject = always)"`
    - **"Yes, save it"** → make BOTH calls:
      1. `muggle-local-preferences-set` with `key: "autoSelectProject"`, `value: "always"`, `scope: "global"`.
      2. `muggle-local-last-project-set` with `cwd`, `projectId`, `projectUrl`, `projectName`.
    - "No, just for this run" → continue without saving.

Ask the user to pick **project**, **use case**, and **test case** (do not infer).

- `muggle-remote-project-list`
- `muggle-remote-use-case-list` (with `projectId`)
- `muggle-remote-test-case-list-by-use-case` (with `useCaseId`)

**Selection UI (mandatory):** Every selection MUST use `AskQuestion` with clickable options. Never ask the user to "reply with the number" in plain text.

**Project selection context:** A **project** groups all your test results, use cases, and test scripts on the Muggle AI dashboard. Include the project URL in each option label so the user can identify the right one.

Prompt for projects: "Pick the project to group this test into:"

**Relevance-first filtering (mandatory for project, use case, and test case lists):**

- Do **not** dump the full list by default.
- Rank items by semantic relevance to the user's stated goal (title first, then description / user story / acceptance criteria).
- Show only the **top 3-5** most relevant options via `AskQuestion`, plus these fixed tail options:
  - **"Show full list"** — present the complete list in a new `AskQuestion` call. **Skip this option** if the API returned zero rows.
  - **"Create new ..."** — never omitted. Label per step: "Create new project", "Create new use case", or "Create new test case".

**Create new — tools and flow (use these MCP tools; preview before persist):**

- **Project — Create new project:** Collect `projectName`, `description`, and `url` (may be the local app URL, e.g. `http://localhost:3999`). Call `muggle-remote-project-create`. Use the returned `projectId` and continue.
- **Use case — Create new use case:** User provides a natural-language instruction (or you reuse their testing goal).
  1. `muggle-remote-use-case-prompt-preview` with `projectId`, `instruction` — show preview; get confirmation via `AskQuestion`.
  2. `muggle-remote-use-case-create-from-prompts` with `projectId` and `instructions: ["<the user's natural-language instruction>"]` — persist. Use the created use case id and continue to test-case selection.
- **Test case — Create new test case** (requires a chosen `useCaseId`): User provides an instruction describing what to test.
  1. `muggle-remote-test-case-generate-from-prompt` with `projectId`, `useCaseId`, `instruction` — **preview only** (server test-case prompt preview); show the returned draft(s); get confirmation via `AskQuestion`.
  2. Persist the accepted draft with `muggle-remote-test-case-create`, mapping preview fields into the required properties (`title`, `description`, `goal`, `expectedResult`, `url`, etc.). Then continue from **section 5** with that `testCaseId`.

### 3. Ensure Local Services Are Ready

Before detecting the local URL, verify that the services the user needs are actually running. Use the `muggle:muggle-test-prepare` integration contract:

1. Check if `/tmp/muggle-test-prepare.json` exists.
2. If it exists, verify tracked PIDs are alive with `kill -0`.
3. If all live → services are ready, proceed to Step 4 (Local URL).
4. If the file is missing or has stale PIDs → invoke the `muggle:muggle-test-prepare` skill via the `Skill` tool to get services started. Once it completes, proceed to Step 4.

This step is especially important when the user's app depends on sibling services (a backend API, an auth service, etc.) that may not be running yet. The prepare skill handles discovery, startup, and cleanup so this skill doesn't have to.

### 4. Local URL

Try to auto-detect the dev server URL by checking running terminals or common ports (e.g., `lsof -iTCP -sTCP:LISTEN -nP | grep -E ':(3000|3001|4200|5173|8080)'`). If a likely URL is found, present it as a clickable default via `AskQuestion`:
- Option 1: "http://localhost:3000" (or whatever was detected)
- Option 2: "Other — let me type a URL"

If nothing detected, ask as free text: "Your local app should be running. What's the URL? (e.g., http://localhost:3000)"

Remind them: local URL is only the execution target, not tied to cloud project config.

### 5. Existing scripts vs new generation

`muggle-remote-test-script-list` with `testCaseId`.

- **If any replayable/succeeded scripts exist:** use `AskQuestion` to present them as clickable options. Show: name, created/updated, step count per option. Include **"Generate new script"** as the last option.
- **If none:** go straight to generation (no need to ask replay vs generate).

### 6. Load data for the chosen path

**Determine `freshSession`**

Before calling either execution tool, inspect the test case content (title, goal, instructions, preconditions) for signals that the test requires a **clean browser state** — no prior cookies, localStorage, or logged-in session. Pass `freshSession: true` when the test case involves any of:

- **Registration / sign-up** — creating a new account
- **Login / authentication** — verifying the login flow itself (not a test that merely *uses* login as a prerequisite)
- **Cookie consent / GDPR banners** — verifying first-visit consent prompts
- **Onboarding flows** — first-time user experiences that only appear on a fresh session

If none of the above apply, omit `freshSession` (defaults to `false`, preserving any existing session state).

**Generate**

1. `muggle-remote-test-case-get`
2. `muggle-local-execute-test-generation` with that test case + `localUrl` (optional: `showUi: false` for headless — defaults to visible; **`freshSession`** — see above; **`timeoutMs`** — see below)

**Replay**

1. `muggle-remote-test-script-get` — note `actionScriptId`
2. `muggle-remote-action-script-get` with that id — full `actionScript`
   **Use the API response as-is.** Do not edit, shorten, or rebuild `actionScript`; replay needs full `label` paths for element lookup.
3. `muggle-local-execute-replay` with `testScript`, `actionScript`, `localUrl` (optional: `showUi: false` for headless — defaults to visible; **`freshSession`** — see above; **`timeoutMs`** — see below)

### Local execution timeout (`timeoutMs`)

The MCP client often uses a **default wait of 300000 ms (5 minutes)** for `muggle-local-execute-test-generation` and `muggle-local-execute-replay`. **Exploratory script generation** (Auth0 login, dashboards, multi-step wizards, many LLM iterations) routinely **runs longer than 5 minutes** while Electron is still healthy.

- **Always pass `timeoutMs`** for flows that may be long — for example **`600000` (10 min)** or **`900000` (15 min)** — unless the user explicitly wants a short cap.
- If the tool reports **`Electron execution timed out after 300000ms`** (or similar) **but** Electron logs show the run still progressing (steps, screenshots, LLM calls), treat it as **orchestration timeout**, not an Electron app defect: **increase `timeoutMs` and retry**.
- **Test case design:** Preconditions like "a test run has already completed" on an **empty account** can force many steps (sign-up, new project, crawl). Prefer an account/project that **already has** the needed state, or narrow the test goal so generation does not try to create a full project from scratch unless that is intentional.

### Interpreting `failed` / non-zero Electron exit

- **`Electron execution timed out after 300000ms`:** Orchestration wait too short — see **`timeoutMs`** above.
- **Exit code 26** (and messages like **LLM failed to generate / replay action script**): Often corresponds to a completed exploration whose **outcome was goal not achievable** (`goal_not_achievable`, summary with `halt`) — e.g. verifying "view script after a successful run" when **no run or script exists yet** in the UI. Use `muggle-local-run-result-get` and read the **summary / structured summary**; do not assume an Electron crash. **Fix:** choose a **project that already has** completed runs and scripts, or **change the test case** so preconditions match what localhost can satisfy (e.g. include steps to create and run a test first, or assert only empty-state UI when no runs exist).

### 7. Execute (no approval prompt; `showUi` gated by `showElectronBrowser`)

Call `muggle-local-execute-test-generation` or `muggle-local-execute-replay` directly. **Do not** ask the user to re-approve the Electron launch — the user choosing this skill in the first place is the approval.

Apply the `showElectronBrowser` gate to decide whether to pass `showUi: false`:
- **`showElectronBrowser = always`** → omit `showUi` (defaults to visible). Skip both pickers.
- **`showElectronBrowser = never`** → pass `showUi: false` (headless). Skip both pickers.
- **`showElectronBrowser = ask` (or absent)** → only ask if the user has not already stated a preference in this session. Otherwise default to visible. If asking, run the 2-picker flow:
  - **Picker 1**: `"Show the Electron browser window during this run?"`
    - "Yes, show the browser" → maps to `showElectronBrowser = always`. Omit `showUi`.
    - "No, run headless" → maps to `showElectronBrowser = never`. Pass `showUi: false`.
  - **Picker 2**: `"Remember this? Next time I'll automatically <show the browser | run headless> without asking. (preference: showElectronBrowser = <always|never>)"`
    - "Yes, save it" → call `muggle-local-preferences-set` with `key: "showElectronBrowser"`, `value: "<always|never>"`, `scope: "global"`.
    - "No, just for this run" → continue without saving.

### 8. After successful generation only (open `viewUrl` gated by `openTestResultsAfterRun`)

- `muggle-local-publish-test-script`
- Apply the `openTestResultsAfterRun` gate to decide whether to open the returned `viewUrl`:
  - **`openTestResultsAfterRun = always`** → open `viewUrl` automatically (`open "<viewUrl>"` on macOS or OS equivalent). Skip both pickers.
  - **`openTestResultsAfterRun = never`** → don't open. Just print the URL so the user can copy it. Skip both pickers.
  - **`openTestResultsAfterRun = ask` (or absent)** → run the 2-picker flow:
    - **Picker 1**: `"Open the run on Muggle dashboard now?"`
      - "Yes, open it" → maps to `openTestResultsAfterRun = always`. Open `viewUrl`.
      - "No, just print the URL" → maps to `openTestResultsAfterRun = never`. Print and continue.
    - **Picker 2**: `"Remember this? Next time I'll automatically <open the dashboard | print the URL only> without asking. (preference: openTestResultsAfterRun = <always|never>)"`
      - "Yes, save it" → call `muggle-local-preferences-set` with `key: "openTestResultsAfterRun"`, `value: "<always|never>"`, `scope: "global"`.
      - "No, just for this run" → continue without saving.

### 9. Report

- `muggle-local-run-result-get` with the run id from execute.
- Include: status, duration, pass/fail summary, per-step summary, artifact/screenshot paths, errors if failed, and script view URL when publishing ran.

### 10. Offer to post a visual walkthrough to the PR

After reporting results, gather the required input and hand off to the shared **`muggle:muggle-pr-visual-walkthrough`** skill, which renders the walkthrough via `muggle build-pr-section` and posts it to the current branch's open PR.

#### 10a: Gather per-step screenshots

The shared skill takes an **`E2eReport` JSON** that includes per-step screenshot URLs. After step 8 has called `muggle-local-publish-test-script` and you have the `testScriptId`:

1. Call `muggle-remote-test-script-get` with the `testScriptId`.
2. Extract per step: `steps[].operation.action` and `steps[].operation.screenshotUrl`.
3. Build the `steps` array: `[{ stepIndex: 0, action: "...", screenshotUrl: "..." }, ...]`.
4. If the run failed, capture `failureStepIndex`, `error`, and the local `artifactsDir` from the run result in step 9.
5. Populate `description` (test case title/description) and `useCaseName` (parent use case title) on the report entry — optional but strongly recommended; they drive the grouped overview and the per-test collapsible headers. Prefer values already in your conversation context from earlier steps (e.g. the test case you just created or selected, or the use case you confirmed); only call `muggle-remote-test-case-get` / `muggle-remote-use-case-get` for anything you don't already have.

Assemble the `E2eReport`:

```json
{
  "projectId": "<projectId from step 2 (Targets)>",
  "tests": [
    {
      "name": "<test case title>",
      "description": "<one-line description of what this test verifies (optional but recommended)>",
      "useCaseName": "<parent use case title (optional but recommended)>",
      "testCaseId": "<id>",
      "testScriptId": "<id from publish>",
      "runId": "<runId from execute>",
      "viewUrl": "<viewUrl from publish>",
      "status": "passed",
      "steps": [{ "stepIndex": 0, "action": "...", "screenshotUrl": "..." }]
    }
  ]
}
```

See the `muggle:muggle-pr-visual-walkthrough` skill for the full schema including the failed-test shape.

#### 10b: Ask the user

Use `AskQuestion`:

> "Post a visual walkthrough of this run to the PR? Reviewers can click the test case to see step-by-step screenshots on the Muggle AI dashboard."

- Option 1: "Yes, post to PR"
- Option 2: "Skip"

#### 10c: Invoke the shared skill in Mode A

If the user chooses "Yes, post to PR", invoke the `muggle:muggle-pr-visual-walkthrough` skill via the `Skill` tool. With the `E2eReport` in context, the skill renders the markdown block via the CLI, finds the PR via `gh pr view`, posts `body` as a comment, posts the overflow `comment` only if the CLI emitted one, and confirms the PR URL to the user.

Always use **Mode A** (post to existing PR) from this skill. Never hand-write the walkthrough markdown or call `gh pr comment` directly — delegate to `muggle:muggle-pr-visual-walkthrough`.

## Non-negotiables

- No silent auth skip.
- **Never prompt for Electron launch approval** before execution — invoking this skill is the approval. Just run.
- If replayable scripts exist, do not default to generation without user choice.
- No hiding failures: surface errors and artifact paths.
- Replay: never hand-built or simplified `actionScript` — only from `muggle-remote-action-script-get`.
- Use `AskQuestion` for every selection — project, use case, test case, script. Never ask the user to type a number.
- Project, use case, and test case selection lists must always include "Create new ...". Include "Show full list" whenever the API returned at least one row for that step; omit "Show full list" when the list is empty (offer "Create new ..." only). For creates, use preview tools (`muggle-remote-use-case-prompt-preview`, `muggle-remote-test-case-generate-from-prompt`) before persisting.
- PR posting is always optional and always delegated to the `muggle:muggle-pr-visual-walkthrough` skill — never inline the walkthrough markdown or call `gh pr comment` directly from this skill.
