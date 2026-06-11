# muggle-test reference

Lookup material pulled out of `SKILL.md` to keep the always-loaded body lean. Every tool here is also named inline in the step that uses it — consult this only when you want the full phase→tool map in one place.

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
| Results + cloud refs (studio-published `viewUrl` / `cloudTestScriptId` / `cloudActionScriptId`) | `muggle-local-run-result-get` | Local |
| Results | `muggle-remote-wf-get-ts-gen-latest-run`, `muggle-remote-wf-get-ts-replay-latest-run` | Remote |
| Per-step screenshots (for walkthrough) | `muggle-remote-test-script-get` | Both |
| Browser | `open` (shell command) | Both |
| PR walkthrough | `muggle-pr-visual-walkthrough` (shared skill) | Both |

## Agent Dispatch

In a multi-agent team (e.g. muggle-ai-teams), this skill is reachable through the **acceptance-tester** agent at `plugin/agents/acceptance-tester.md`. Orchestrators dispatch it via `Agent()` instead of invoking the skill directly. The agent wraps this skill and four others (muggle-test-import, muggle-preferences, muggle-repair, muggle-status) and returns structured test results with blocking issues and suggested fixes for coding agents to act on.
