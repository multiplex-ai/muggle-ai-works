---
name: muggle-test-feature-local
description: Run a real-browser QA test against localhost to verify a feature works correctly — signup flows, checkout, form validation, UI interactions, or any user-facing behavior. Launches a browser that executes test steps and captures screenshots. Use this skill whenever the user asks to test, QA, validate, or verify their web app, UI changes, user flows, or frontend behavior on localhost or a dev server — even if they don't mention 'muggle' or 'QA' explicitly.
---

# Muggle Test Feature Local

Run end-to-end feature testing from UI against a local URL:

- Cloud management: `muggle-remote-*`
- Local execution and artifacts: `muggle-local-*`

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

Check BOTH cloud and local scripts to determine what's available:

1. **Check cloud scripts:** `muggle-remote-test-script-list` filtered by projectId
2. **Check local scripts:** `muggle-local-test-script-list` filtered by projectId

**Decision logic:**

| Cloud Script | Local Script (status: published/generated) | Action |
|--------------|---------------------------------------------|--------|
| Exists + ACTIVE | Exists | Ask user: "Replay existing script" or "Regenerate from scratch"? |
| Exists + ACTIVE | Not found | Sync from cloud first, then ask user |
| Not found | Exists | Ask user: "Replay local script" or "Regenerate"? |
| Not found | Not found | Default to generation (no need to ask) |

**When asking user, show:**
- Script name and ID
- When it was created/updated
- Number of steps
- Last run status if available

### 5. Prepare for execution

**For Replay:**

Local scripts contain the complete `actionScript` with element labels required for replay. Remote scripts only contain metadata.

1. Use `muggle-local-test-script-get` with `testScriptId` to fetch the FULL script including actionScript
2. The returned script includes all steps with `operation.label` paths needed for element location
3. Pass this complete script to `muggle-local-execute-replay`

**IMPORTANT:** Do NOT manually construct or simplify the actionScript. The electron app requires the complete script with all `label` paths intact to locate page elements during replay.

**For Generation:**

1. `muggle-remote-test-case-get` to fetch test case details
2. `muggle-local-execute-test-generation` with the test case

### 6. Approval requirement

- Before execution, get explicit user approval for launching Electron app.
- Show what will be executed (replay vs generation, test case name, URL).
- Only then set `approveElectronAppLaunch: true`.

### 7. Execute

**Replay:**
```
muggle-local-execute-replay with:
- testScript: (full script from muggle-local-test-script-get)
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
- Return the remote URL for user to view the result.

### 9. Report results

- `muggle-local-run-result-get` with returned runId.
- Report:
  - status (passed/failed)
  - duration
  - pass/fail summary
  - steps summary (which steps passed/failed)
  - artifacts path (screenshots location)
  - script detail view URL

## Guardrails

- Do not silently skip auth.
- Do not silently skip asking user when a replayable script exists.
- Do not launch Electron without explicit approval.
- Do not hide failing run details; include error and artifacts path.
- Do not simplify or reconstruct actionScript for replay; use the complete script from `muggle-local-test-script-get`.
- Always check local scripts before defaulting to generation.
