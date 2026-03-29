---
name: muggle-test-feature-local
description: Run a real-browser QA test against localhost to verify a feature works correctly — signup flows, checkout, form validation, UI interactions, or any user-facing behavior. Launches a browser that executes test steps and captures screenshots. Use this skill whenever the user asks to test, QA, validate, or verify their web app, UI changes, user flows, or frontend behavior on localhost or a dev server — even if they don't mention 'muggle' or 'QA' explicitly.
---

# Muggle Test Feature Local

Run end-to-end feature testing from UI against a local URL:

- Cloud management and artifacts: `muggle-remote-*`
- Local execution: `muggle-local-*`

## Workflow

### 1. Auth

- `muggle-remote-auth-status`
- If needed: `muggle-remote-auth-login` + `muggle-remote-auth-poll`

### 2. Select project, use case, and test case

- Explicitly ask user to select each target to proceed.
- `muggle-remote-project-list`
- `muggle-remote-use-case-list`
- `muggle-remote-test-case-list-by-use-case`

### 3. Resolve local URL

- Use the URL provided by the user.
- If missing, ask explicitly (do not guess).
- Inform user the local URL does not affect the project's remote test.

### 4. Check for existing scripts and ask user to choose

Use `muggle-remote-test-script-list` with `testCaseId` to get scripts for the selected test case.

**Present options to user:**

- List all succeeded/replayable scripts
- Always include "Generate new script" as an option

If no scripts exist, skip asking and default to generation.

**When listing scripts, show:**
- Script name and ID
- When it was created/updated
- Number of steps

### 5. Prepare for execution

**For Generation:**

1. `muggle-remote-test-case-get` to fetch test case details
3. `muggle-local-execute-test-generation` with the test case

**For Replay:**

All generated scripts are automatically uploaded to the cloud. Every test script has a remote copy that is replayable.

1. Use `muggle-remote-test-script-get` with `testScriptId` to fetch the test script metadata (includes `actionScriptId`)
2. Use `muggle-remote-action-script-get` with the `actionScriptId` from step 1 to fetch the full actionScript content
3. Pass both `testScript` and `actionScript` to `muggle-local-execute-replay`

**IMPORTANT:** Do NOT manually construct or simplify the actionScript. The electron app requires the complete script with all `label` paths intact to locate page elements during replay.
### 6. Approval requirement

- Before execution, get explicit user approval for launching Electron app.
- Show what will be executed (replay vs generation, test case name, URL).
- Only then set `approveElectronAppLaunch: true`.

### 7. Execute

**Replay:**
```
muggle-local-execute-replay with:
- testScript: (metadata from muggle-remote-test-script-get)
- actionScript: (content from muggle-remote-action-script-get using testScript.actionScriptId)
- localUrl: user-provided localhost URL
- approveElectronAppLaunch: true
- showUi: true (optional, lets user watch)
```

**Generation:**
```
muggle-local-execute-test-generation with:
- testCase: (from muggle-remote-test-case-get)
- localUrl: user-provided localhost URL
- approveElectronAppLaunch: true
- showUi: true (optional)
```

### 8. Publish generation results (generation only)

- Use `muggle-local-publish-test-script` after successful generation.
- This uploads the script to cloud so it can be replayed later.
- The tool returns a `viewUrl` in the response data.
- Open the `viewUrl` in the user's default browser using `open "<viewUrl>"` (macOS) or equivalent so they can view the published test script details on the dashboard.

### 9. Report results

- `muggle-local-run-result-get` with returned runId.
- Report:
  - status (passed/failed)
  - duration
  - pass/fail summary
  - steps summary (which steps passed/failed)
  - artifacts path (screenshots location)
  - script detail view URL (from `muggle-local-publish-test-script` response, already opened in browser)

## Guardrails

- Do not silently skip auth.
- Do not silently skip asking user when a replayable script exists.
- Do not launch Electron without explicit approval.
- Do not hide failing run details; include error and artifacts path.
- Do not simplify or reconstruct actionScript for replay; use the complete script from `muggle-remote-action-script-get`.
- Always check for existing scripts before defaulting to generation.
