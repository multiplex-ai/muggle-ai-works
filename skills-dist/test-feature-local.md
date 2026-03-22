---
name: test-feature-local
description: Test a feature's user experience on localhost. Sync entities in cloud (muggle-remote-* tools), then execute locally (muggle-local-* tools) against localhost. Requires explicit approval before launching electron-app.
---

# Test Feature Locally (Cloud-First Approach)

Test a feature's user experience on a local web app using a cloud-first workflow:
- **muggle-remote-* tools**: Authentication and all entity management (projects, use cases, test cases)
- **muggle-local-* tools**: Local execution, results viewing, and publishing

## Design Principle

**"Create remotely, execute locally"** - All entity management happens in the cloud via `muggle-remote-*` tools. Local `muggle-local-*` tools only handle execution and results.

## Workflow Overview

```
muggle-remote-auth-login → Authenticate with Muggle AI
      ↓
muggle-remote-project-* → List projects → [Prompt user to pick]
      ↓
muggle-remote-use-case-* → List use cases → [Prompt user to pick]
      ↓
muggle-remote-test-case-* → List test cases → [Prompt user to pick]
      ↓
muggle-remote-test-script-list → Check for existing scripts
      ↓
[Analyze git changes → recommend replay or regenerate]
      ↓
muggle-local-execute-replay OR muggle-local-execute-test-generation
      ↓
muggle-local-run-result-* → View execution results
      ↓
muggle-local-publish-test-script → Publish script back to cloud
```

## Prerequisites

- MCP server running with both `muggle-remote-*` and `muggle-local-*` tools available
- Target local app running (e.g., `http://localhost:3000`)
- Feature description from user, or repo changes to analyze

## Tool Namespace Summary

| Namespace             | Purpose                           | Examples                                                     |
| :-------------------- | :-------------------------------- | :----------------------------------------------------------- |
| `muggle-remote-auth-*`| Authentication                    | `muggle-remote-auth-login`, `muggle-remote-auth-status`      |
| `muggle-remote-*`     | Cloud entity management           | `muggle-remote-project-create`, `muggle-remote-test-case-create` |
| `muggle-local-*`      | Local execution & results         | `muggle-local-execute-test-generation`                       |

## Step 0: Authentication (Required)

Always verify auth before testing. Auth tools are in `muggle-remote-*` namespace.

1. Call `muggle-remote-auth-status`
2. Check the response:
   - **If authenticated and not expired**: Proceed to Step 1
   - **If not authenticated or token expired**: Continue to step 3
3. Call `muggle-remote-auth-login` to start authentication
4. If login remains pending, call `muggle-remote-auth-poll`
5. Proceed only when authenticated

### Handling Expired Tokens

If `muggle-remote-auth-status` shows expired credentials (check `expiresAt` field):

1. **Token expired**: Call `muggle-remote-auth-login` to re-authenticate
2. **Login fails with "unauthorized_client"**: This indicates environment mismatch
   - Check if MCP is configured for the correct environment (production vs dev)
   - User may need to update `MUGGLE_MCP_PROMPT_SERVICE_TARGET` in their MCP config
   - After config change, user must restart Cursor and retry

### Authentication Failure Recovery

If authentication repeatedly fails:

1. Suggest user run `muggle logout` then `muggle login` from terminal
2. Or delete credential files manually: `~/.muggle-ai/auth.json` and `~/.muggle-ai/credentials.json`
3. Ensure MCP configuration has correct environment variable set

## Step 1: Select or Create Cloud Project

Use `muggle-remote-*` tools for all project management.

### Option A: Use Existing Cloud Project (Preferred)

1. Call `muggle-remote-project-list` to list available projects
2. Analyze and rank by relevance to user's request (name, description, URL match)
3. **Recommend the best match** with reasoning, present other options
4. **Confirm with user** before proceeding
5. Note the `projectId` for subsequent calls

### Option B: Create New Cloud Project

1. Propose project details and ask user confirmation:
   - `projectName`: Project name
   - `description`: Project description
   - `url`: Production URL (will be replaced with localhost during local execution)
2. Call `muggle-remote-project-create` with the final project details


## Step 2: Analyze Current Changes (Optional)

When user says "test my changes" or scope is vague, inspect repo deltas:

```bash
git status
git diff
git diff --cached
git log -3 --oneline
```

Extract impacted feature areas to prioritize use cases/test cases.

## Step 3: Select or Create Cloud Use Cases

Use `muggle-remote-*` tools for use case management.

### Option A: Use Existing Cloud Use Cases (Preferred)

1. Call `muggle-remote-use-case-list` with the project ID
2. Analyze and rank by relevance to user's feature/changes (title, user story match)
3. **Recommend the best match** with reasoning, present other options
4. **Confirm with user** before proceeding
5. Note the `useCaseId` for test case selection

### Option B: Create New Cloud Use Cases

1. Call `muggle-remote-use-case-create-from-prompts`:
   - `projectId`: The cloud project ID
   - `prompts`: Array of natural language descriptions

Or use the two-step flow:
1. Call `muggle-remote-use-case-prompt-preview` to generate preview
2. Review and confirm to create

## Step 4: Select or Create Cloud Test Cases

Use `muggle-remote-*` tools for test case management.

### Option A: Use Existing Cloud Test Cases (Preferred)

1. Call `muggle-remote-test-case-list-by-use-case` with the use case ID
2. Analyze and rank by relevance to user's testing goal (title, goal, instructions match)
3. **Recommend the best match** with reasoning, present other options
4. **Confirm with user** before proceeding
5. Note the `testCaseId` for execution

### Option B: Create New Cloud Test Cases

1. Call `muggle-remote-test-case-generate-from-prompt`:
   - `projectId`: The cloud project ID
   - `useCaseId`: The use case ID
   - `instruction`: Natural language description of what to test

2. Then call `muggle-remote-test-case-create` to save the generated test case

When multiple candidates match:
- Group by use case
- Mark impacted candidates (if change analysis exists)
- Ask user whether to run all impacted or specific cases

## Step 5: Execute Test Locally

Use `muggle-remote-*` tools to fetch details, then `muggle-local-*` tools for local execution.

### Check for Existing Scripts First

1. **Check for existing scripts**: Call `muggle-remote-test-script-list` with the project ID
   - Filter results by `testCaseId` to find scripts for the selected test case

2. **If no existing script found**: Proceed directly to generate new script

3. **If existing script found**: Analyze changes and make a recommendation

### Analyze Changes to Recommend Replay vs Regenerate

When an existing script is found, analyze the current git changes to make an informed recommendation:

1. **Inspect repo changes**:
   ```bash
   git diff --name-only
   git diff
   ```

2. **Classify the change impact**:
   - **Significant (user-flow level)**: Changes to UI components, page layouts, navigation, form fields, button labels, or interaction flows that the test script interacts with
   - **Minor (non-user-flow)**: Backend logic, API changes, styling tweaks, refactoring, or changes to unrelated features

3. **Make recommendation to user**:
   - **Recommend REGENERATE** if significant user-flow changes detected:
     > "I found an existing script, but detected significant UI/flow changes in [affected areas]. Recommend regenerating the test script to capture the new flow. Proceed with regeneration?"
   - **Recommend REPLAY** if only minor changes or no relevant changes:
     > "I found an existing script and the changes appear minor (no user-flow impact). Recommend replaying the existing script for faster execution. Proceed with replay?"

4. **Let user decide**: Present both options with the recommendation highlighted, allow user to override

### Option A: Replay Existing Script

1. **Fetch script details**: Call `muggle-remote-test-script-get` with the test script ID
   - This returns: `id`, `name`, `testCaseId`, `actionScript`, `url`

2. **Execute locally**: Call `muggle-local-execute-replay`:
   - `testScript`: The full test script object from step 1
   - `localUrl`: The localhost URL
   - `approveElectronAppLaunch`: **Must be `true`** (requires explicit user approval)

### Option B: Generate New Script

1. **Fetch test case details**: Call `muggle-remote-test-case-get` with the test case ID
   - This returns: `id`, `title`, `goal`, `expectedResult`, `precondition`, `instructions`, `url`

2. **Execute locally**: Call `muggle-local-execute-test-generation`:
   - `testCase`: The full test case object from step 1
   - `localUrl`: The localhost URL (e.g., `http://localhost:3000`)
   - `approveElectronAppLaunch`: **Must be `true`** (requires explicit user approval)

### Explicit Approval Requirement (Critical)

Before calling execution tools, get explicit user approval to launch Electron app.

**Never** set `approveElectronAppLaunch: true` without user confirmation.

## Step 6: View and Summarize Results

Use `muggle-local-*` tools for results:

- `muggle-local-run-result-list` - List recent runs (optionally filtered by `cloudTestCaseId`)
- `muggle-local-run-result-get` - Get detailed run info including screenshots, action script, and ending state

**Always print the ending state** after execution completes. Use the `runId` returned by `muggle-local-execute-test-generation` or `muggle-local-execute-replay`, call `muggle-local-run-result-get`, then report:

- **Status:** passed / failed
- **Duration:** execution time in ms
- **Steps generated:** number of action script steps (for generation runs)
- **Artifacts path:** where the user can view the action script and screenshots (e.g. `~/.muggle-ai/sessions/{runId}/`)

Tell the user they can open the artifacts folder to see:
- `action-script.json` — generated test steps
- `results.md` — step-by-step report with screenshot links
- `screenshots/` — per-step images (`step-001.png`, `step-002.png`, …)

For batch runs, return a compact summary table/list and print the ending state for the most recent run.

## Step 7: Publish to Cloud (Optional)

After successful local execution, offer to publish the generated script to cloud.

1. Call `muggle-local-publish-test-script`:
   - `runId`: The run result ID from step 5
   - `cloudTestCaseId`: The cloud test case ID

This uploads the generated action script to the cloud for future replays.

## Quick Reference

### Authentication (muggle-remote-auth-*)

| Action       | Tool                          |
| :----------- | :---------------------------- |
| Check auth   | `muggle-remote-auth-status`   |
| Start login  | `muggle-remote-auth-login`    |
| Poll login   | `muggle-remote-auth-poll`     |
| Logout       | `muggle-remote-auth-logout`   |

### Cloud Entity Management (muggle-remote-*)

| Action                  | Tool                                          |
| :---------------------- | :-------------------------------------------- |
| List projects           | `muggle-remote-project-list`                  |
| Create project          | `muggle-remote-project-create`                |
| Get project             | `muggle-remote-project-get`                   |
| List use cases          | `muggle-remote-use-case-list`                 |
| Create use cases        | `muggle-remote-use-case-create-from-prompts`  |
| List test cases         | `muggle-remote-test-case-list-by-use-case`    |
| Generate test cases     | `muggle-remote-test-case-generate-from-prompt`|
| Create test case        | `muggle-remote-test-case-create`              |
| Get test case           | `muggle-remote-test-case-get`                 |
| List test scripts       | `muggle-remote-test-script-list`              |
| Get test script         | `muggle-remote-test-script-get`               |

### Local Execution (muggle-local-*)

| Action                | Tool                                  |
| :-------------------- | :------------------------------------ |
| Check local status    | `muggle-local-check-status`           |
| List sessions         | `muggle-local-list-sessions`          |
| Generate script       | `muggle-local-execute-test-generation`|
| Replay script         | `muggle-local-execute-replay`         |
| Cancel execution      | `muggle-local-cancel-execution`       |
| List run results      | `muggle-local-run-result-list`        |
| Get run details       | `muggle-local-run-result-get`         |
| List local scripts    | `muggle-local-test-script-list`       |
| Get local script      | `muggle-local-test-script-get`        |
| Publish script        | `muggle-local-publish-test-script`    |

## Example Interaction

**User:** "Test my login changes on localhost:3999"

**Agent flow:**

1. `muggle-remote-auth-status` (login if required using `muggle-remote-auth-login`)

2. `muggle-remote-project-list` to find existing project
   - If found: Use existing project ID
   - If not found: `muggle-remote-project-create` with production URL

3. Analyze git diff to identify auth/login impact

4. `muggle-remote-use-case-list` to find login-related use case
   - If not found: `muggle-remote-use-case-create-from-prompts` with login user story

5. `muggle-remote-test-case-list-by-use-case` to find relevant test cases
   - If not found: `muggle-remote-test-case-generate-from-prompt` + `muggle-remote-test-case-create`

6. **Check for existing scripts**: `muggle-remote-test-script-list` filtered by test case ID
   - If script exists: Analyze git diff from step 3
   - If changes affect user flow (UI components, navigation, forms): Recommend regenerate
   - If changes are minor (backend, styling, unrelated): Recommend replay
   - Present recommendation with both options to user

7. Ask user for approval to launch Electron app

8. **If replaying**: `muggle-remote-test-script-get` then `muggle-local-execute-replay`
   **If generating new**: `muggle-remote-test-case-get` then `muggle-local-execute-test-generation`:
   - `localUrl`: "http://localhost:3999"
   - `approveElectronAppLaunch`: true

9. `muggle-local-run-result-get` with the `runId` from the execution result to view results

10. **Print the ending state** to user: status, duration, steps count, and artifacts path. Tell the user they can open the artifacts folder to view action script (`action-script.json`), step report (`results.md`), and screenshots (`step-001.png`, `step-002.png`, …). Summarize pass/fail.

11. Offer `muggle-local-publish-test-script` to upload script to cloud

## Notes

- **Cloud-first**: All entity management happens via `muggle-remote-*` tools
- **Fetch-then-execute**: Call `muggle-remote-test-case-get` or `muggle-remote-test-script-get` first, then pass the full object to `muggle-local-execute-*` tools
- **Local execution only**: `muggle-local-*` tools have no cloud dependencies - they receive all data they need as input
- **URL replacement**: The `localUrl` parameter replaces the cloud URL during local execution
- **Explicit approval required**: Never launch Electron without user confirmation
- Secrets and workflow files are managed via `muggle-remote-secret-*` and `muggle-remote-workflow-*` cloud tools
