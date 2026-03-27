---
name: test-feature-local
description: Test a feature's user experience on localhost. Execute locally with muggle-local tools, and present the results on muggle-ai.com.
---

# Test Feature Local

Run end-to-end feature testing from UI against a local URL:

- Cloud management: `muggle-remote-*`
- Local execution and artifacts: `muggle-local-*`

## Workflow

1. **Auth**
   - `muggle-remote-auth-status`
   - If needed: `muggle-remote-auth-login` + `muggle-remote-auth-poll`

2. **Select or create the project -> use case -> test case to use**
   - Explictly ask user to select each target to proceed.
   - `muggle-remote-project-list`
   - `muggle-remote-use-case-list`
   - `muggle-remote-test-case-list-by-use-case`

3. **Resolve local URL**
   - Use the URL provided by the user.
   - If missing, ask explicitly (do not guess).
   - Inform user the local URL does not affect the project's remote test.

4. **Check script availability**
   - `muggle-remote-test-script-list` filtered by testCaseId
   - If script exists, recommend replay unless user-flow changes suggest regeneration.

5. **Execute**
   - Replay path:
     - `muggle-remote-test-script-get`
     - `muggle-local-execute-replay`
   - Generation path:
     - `muggle-remote-test-case-get`
     - `muggle-local-execute-test-generation`

6. **Approval requirement**
   - Before execution, get explicit user approval for launching Electron app.
   - Only then set `approveElectronAppLaunch: true`.

7. **Publish local generation result to MuggleTest cloud records**
   - Use `muggle-local-publish-test-script` after successful generation so user can see the full job details.
   - Return the remote URL for user to view the result and script details.

8. **Report results**
   - `muggle-local-run-result-get` with returned runId.
   - Report:
     - status
     - duration
     - pass/fail summary
     - steps summary
     - artifacts path
     - script detail view URL

## Tool map

### Auth
- `muggle-remote-auth-status`
- `muggle-remote-auth-login`
- `muggle-remote-auth-poll`
- `muggle-remote-auth-logout`

### Cloud entities
- `muggle-remote-project-list`
- `muggle-remote-project-create`
- `muggle-remote-use-case-list`
- `muggle-remote-use-case-create-from-prompts`
- `muggle-remote-test-case-list-by-use-case`
- `muggle-remote-test-case-get`
- `muggle-remote-test-case-generate-from-prompt`
- `muggle-remote-test-script-list`
- `muggle-remote-test-script-get`

### Local execution
- `muggle-local-execute-test-generation`
- `muggle-local-execute-replay`
- `muggle-local-run-result-list`
- `muggle-local-run-result-get`
- `muggle-local-publish-test-script`

## Guardrails

- Do not silently skip auth.
- Do not silently skip test execution when no script exists; generate one.
- Do not launch Electron without explicit approval.
- Do not hide failing run details; include error and artifacts path.
