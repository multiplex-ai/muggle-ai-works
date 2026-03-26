---
name: publish-test-to-cloud
description: Publish a local generation run to cloud workflow records using MCP tools.
---

# Publish Test To Cloud

Publish a locally generated run to Muggle AI cloud so it appears in cloud workflow and test result views.

## Required tools

- `muggle-remote-auth-status`
- `muggle-remote-auth-login`
- `muggle-remote-auth-poll`
- `muggle-local-run-result-list`
- `muggle-local-run-result-get`
- `muggle-local-publish-test-script`
- `muggle-remote-local-run-upload` (manual fallback)

## Default flow

1. Check auth with `muggle-remote-auth-status`.
2. If not authenticated:
   - `muggle-remote-auth-login`
   - `muggle-remote-auth-poll` as needed.
3. Find a local run:
   - `muggle-local-run-result-list`
   - choose a generation run in `passed` or `failed` state.
4. Validate run:
   - `muggle-local-run-result-get`
   - ensure required metadata exists (`projectId`, `useCaseId`, `cloudTestCaseId`, `executionTimeMs`).
5. Publish:
   - `muggle-local-publish-test-script` with `runId` and `cloudTestCaseId`.
6. Return cloud identifiers and view URL from tool response.

## Notes

- Prefer `muggle-local-publish-test-script`.
- Use `muggle-remote-local-run-upload` only for advanced/manual fallback.
- Replay runs are not publishable through this flow.
- If required metadata is missing, fail fast with explicit error context.
