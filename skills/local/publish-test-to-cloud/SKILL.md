---
name: publish-test-to-cloud
description: Publish a local generation run to cloud workflow records using MCP tools.
---

# Publish Test To Cloud

Publish a locally generated run to Muggle AI cloud so it appears in cloud workflow/test result views.

## Required Tools

- `muggle-remote-auth-status`
- `muggle-remote-auth-login`
- `muggle-remote-auth-poll`
- `muggle-local-run-result-list`
- `muggle-local-run-result-get`
- `muggle-local-publish-test-script`
- `muggle-remote-local-run-upload` (advanced/manual path)

## Default Flow

1. Check auth with `muggle-remote-auth-status`.
2. If not authenticated, run login flow:
   - `muggle-remote-auth-login`
   - `muggle-remote-auth-poll` (when pending)
3. Find a local run:
   - `muggle-local-run-result-list`
   - choose a **generation** run in `passed`/`failed` state
4. Validate details:
   - `muggle-local-run-result-get`
   - ensure run has `projectId`, `useCaseId`, `cloudTestCaseId`, `executionTimeMs`, and local execution context
5. Publish:
   - `muggle-local-publish-test-script` with:
     - `runId`
     - `cloudTestCaseId`
6. Return cloud identifiers and view URL from tool response.

## Notes

- `muggle-local-publish-test-script` is the preferred path. It packages local artifacts and uploads to cloud endpoint.
- `muggle-remote-local-run-upload` is available for manual/direct upload when needed.
- Replay runs are not publishable by this skill.
- Hard fail on missing required metadata; do not silently substitute values.
