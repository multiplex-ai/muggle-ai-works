# Muggle Test — Remote Execution Path (Mode B)

> The Remote execution process for the `muggle-test` router: trigger cloud test-script generation/replay against a preview/staging URL and monitor. Returns a uniform runs list to the router.

## Inputs (the router passes these in)

- The hydrated test cases (fetched once by the router before dispatch).
- Per-case `mode` — `replay` or `regen`, chosen during replay-vs-regen classification.
- `projectId`, `useCaseId`.

## Ask for target URL

> "What's the preview/staging URL to test against?"

## Trigger remote workflows (in parallel)

Branch each test case on its `mode`, then issue **all** workflow-start calls in parallel — never loop them sequentially. Mix regen and replay starts in the same parallel batch.

**Regen-mode test case** — `muggle-remote-workflow-start-test-script-generation`:

- `projectId`: The project ID
- `useCaseId`: The use case ID
- `testCaseId`: The test case ID
- `name`: `"muggle-test: {test case title}"`
- `url`: The preview/staging URL
- `goal`: From the test case
- `precondition`: From the test case (use `"None"` if empty)
- `instructions`: From the test case
- `expectedResult`: From the test case

**Replay-mode test case** — `muggle-remote-workflow-start-test-script-replay` against the latest replayable script for that test case (resolve via `muggle-remote-test-script-list` with `runEnvironmentType: "remote"` if not already in hand from the classification step). Tag results with `mode: "replay"` so the router routes failures correctly.

Store each returned workflow runtime ID along with its mode tag.

## Monitor and report (in parallel)

Issue all `muggle-remote-wf-get-ts-gen-latest-run` calls in parallel, one per runtime ID.

```
Test Case                  Workflow Status   Runtime ID
────────────────────────────────────────────────────────
Login with valid creds     RUNNING           rt-abc123
Login with invalid creds   COMPLETED         rt-def456
Checkout flow              QUEUED            rt-ghi789
```

## Output

Return the uniform runs list the router consumes: `[{ testCaseId, mode, runtimeId, status }]`.
