---
name: muggle-test-feature-local
description: Run a real-browser end-to-end (E2E) acceptance test against localhost to verify a feature works correctly — signup flows, checkout, form validation, UI interactions, or any user-facing behavior. Launches a browser that executes test steps and captures screenshots. Use this skill whenever the user asks to test, validate, or verify their web app, UI changes, user flows, or frontend behavior on localhost or a dev server — even if they don't mention 'muggle' or 'E2E' explicitly.
---

# Muggle Test Feature Local

**Goal:** Run or generate an end-to-end test against a **local URL** using Muggle’s Electron browser.

| Scope | MCP tools |
| :---- | :-------- |
| Cloud (projects, cases, scripts, auth) | `muggle-remote-*` |
| Local (Electron run, publish, results) | `muggle-local-*` |
| Create new entities (preview / create) | `muggle-remote-project-create`, `muggle-remote-use-case-prompt-preview`, `muggle-remote-use-case-create-from-prompts`, `muggle-remote-test-case-generate-from-prompt`, `muggle-remote-test-case-create` |

The local URL only changes where the browser opens; it does not change the remote project or test definitions.

## Workflow

### 1. Auth

- `muggle-remote-auth-status`
- If not signed in: `muggle-remote-auth-login` then `muggle-remote-auth-poll`  
  Do not skip or assume auth.

### 2. Targets (user must confirm)

Ask the user to pick **project**, **use case**, and **test case** (do not infer).

- `muggle-remote-project-list`
- `muggle-remote-use-case-list` (with `projectId`)
- `muggle-remote-test-case-list-by-use-case` (with `useCaseId`)

**Selection UI (mandatory):** After each list call, present choices as a **numbered list** (`1.` … `n.`). Keep each line minimal: number, short title, UUID. Ask the user to **reply with the number** or the UUID.

**Fixed tail of each pick list (project, use case, test case):** After the relevance-ranked rows, end with the options below. **Create new …** is never omitted; **Show full list** is omitted when it would be pointless (see empty list).

1. **Show full list** — user sees every row from the API (then re-number the full list including the tails below again). **Skip this option** if the API returned **zero** rows for that step (e.g. no test cases yet for the chosen use case). There is nothing to expand.
2. **Create new …** — user creates a new entity instead of picking an existing one. Label per step: **Create new project**, **Create new use case**, or **Create new test case**.

**Relevance-first filtering (mandatory for project, use case, and test case lists):**

- Do **not** dump the full list by default.
- Rank items by semantic relevance to the user’s stated goal (title first, then description / user story / acceptance criteria).
- Show only the **top 3–5** most relevant options, then **Show full list** (unless the API list is empty — see above), then **Create new …** as above.
- If the user picks **Show full list**, then present the complete numbered list (still ending with **Create new …**; include **Show full list** again only when the full list has at least one row).

**Create new — tools and flow (use these MCP tools; preview before persist):**

- **Project — Create new project:** Collect `projectName`, `description`, and `url` (may be the local app URL, e.g. `http://localhost:3999`). Call `muggle-remote-project-create`. Use the returned `projectId` and continue.
- **Use case — Create new use case:** User provides a natural-language instruction (or you reuse their testing goal).  
  1. `muggle-remote-use-case-prompt-preview` with `projectId`, `instruction` — show preview; get confirmation.  
  2. `muggle-remote-use-case-create-from-prompts` with `projectId`, `prompts: [{ instruction }]` — persist. Use the created use case id and continue to test-case selection.
- **Test case — Create new test case** (requires a chosen `useCaseId`): User provides an instruction describing what to test.  
  1. `muggle-remote-test-case-generate-from-prompt` with `projectId`, `useCaseId`, `instruction` — **preview only** (server test-case prompt preview); show the returned draft(s); get confirmation.  
  2. Persist the accepted draft with `muggle-remote-test-case-create`, mapping preview fields into the required properties (`title`, `description`, `goal`, `expectedResult`, `url`, etc.). Then continue from **§4** with that `testCaseId`.

### 3. Local URL

- Use the URL the user gives. If none, ask; **do not guess**.
- Remind them: local URL is only the execution target, not tied to cloud project config.

### 4. Existing scripts vs new generation

`muggle-remote-test-script-list` with `testCaseId`.

- **If any replayable/succeeded scripts exist:** list them in a **numbered** list and ask: replay one **or** generate new.  
  Show: name, id, created/updated, step count. Include **`Generate new script`** as the **last** numbered option (e.g. last number) so it is selectable by number too.
- **If none:** go straight to generation (no need to ask replay vs generate).

### 5. Load data for the chosen path

**Generate**

1. `muggle-remote-test-case-get`
2. `muggle-local-execute-test-generation` (after approval in step 6) with that test case + `localUrl` + `approveElectronAppLaunch: true` (optional: `showUi: true`, **`timeoutMs`** — see below)

**Replay**

1. `muggle-remote-test-script-get` → note `actionScriptId`
2. `muggle-remote-action-script-get` with that id → full `actionScript`  
   **Use the API response as-is.** Do not edit, shorten, or rebuild `actionScript`; replay needs full `label` paths for element lookup.
3. `muggle-local-execute-replay` (after approval in step 6) with `testScript`, `actionScript`, `localUrl`, `approveElectronAppLaunch: true` (optional: `showUi: true`, **`timeoutMs`** — see below)

### Local execution timeout (`timeoutMs`)

The MCP client often uses a **default wait of 300000 ms (5 minutes)** for `muggle-local-execute-test-generation` and `muggle-local-execute-replay`. **Exploratory script generation** (Auth0 login, dashboards, multi-step wizards, many LLM iterations) routinely **runs longer than 5 minutes** while Electron is still healthy.

- **Always pass `timeoutMs`** for flows that may be long — for example **`600000` (10 min)** or **`900000` (15 min)** — unless the user explicitly wants a short cap.
- If the tool reports **`Electron execution timed out after 300000ms`** (or similar) **but** Electron logs show the run still progressing (steps, screenshots, LLM calls), treat it as **orchestration timeout**, not an Electron app defect: **increase `timeoutMs` and retry** (after user re-approves if your policy requires it).
- **Test case design:** Preconditions like “a test run has already completed” on an **empty account** can force many steps (sign-up, new project, crawl). Prefer an account/project that **already has** the needed state, or narrow the test goal so generation does not try to create a full project from scratch unless that is intentional.

### Interpreting `failed` / non-zero Electron exit

- **`Electron execution timed out after 300000ms`:** Orchestration wait too short — see **`timeoutMs`** above.
- **Exit code 26** (and messages like **LLM failed to generate / replay action script**): Often corresponds to a completed exploration whose **outcome was goal not achievable** (`goal_not_achievable`, summary with `halt`) — e.g. verifying “view script after a successful run” when **no run or script exists yet** in the UI. Use `muggle-local-run-result-get` and read the **summary / structured summary**; do not assume an Electron crash. **Fix:** choose a **project that already has** completed runs and scripts, or **change the test case** so preconditions match what localhost can satisfy (e.g. include steps to create and run a test first, or assert only empty-state UI when no runs exist).

### 6. Approval before any local execution

Get **explicit** OK to launch Electron. State: replay vs generation, test case name, URL.  
Only then call local execute tools with `approveElectronAppLaunch: true`.

### 7. After successful generation only

- `muggle-local-publish-test-script`
- Open returned `viewUrl` for the user (`open "<viewUrl>"` on macOS or OS equivalent).

### 8. Report

- `muggle-local-run-result-get` with the run id from execute.
- Include: status, duration, pass/fail summary, per-step summary, artifact/screenshot paths, errors if failed, and script view URL when publishing ran.

## Non-negotiables

- No silent auth skip; no launching Electron without approval.
- If replayable scripts exist, do not default to generation without user choice.
- No hiding failures: surface errors and artifact paths.
- Replay: never hand-built or simplified `actionScript` — only from `muggle-remote-action-script-get`.
- Project, use case, and test case selection lists must always include **Create new …**. Include **Show full list** whenever the API returned at least one row for that step; **omit Show full list** when the list is empty (offer **Create new …** only). For creates, use preview tools (`muggle-remote-use-case-prompt-preview`, `muggle-remote-test-case-generate-from-prompt`) before persisting.
