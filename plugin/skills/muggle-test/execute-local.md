# Muggle Test — Local Execution Path (Mode A)

> The Local execution process for the `muggle-test` router: run the selected test cases against localhost via the Electron browser and collect results. The studio publishes each run to the cloud during execution, so the run result already carries the cloud refs. Returns a uniform runs list to the router. Per-test-case mechanics are shared with [`../_shared/dev-loop/run.md`](../_shared/dev-loop/run.md).

## Inputs (the router passes these in)

- The hydrated test cases (fetched once by the router before dispatch).
- Per-case `mode` — `replay` or `regen`, chosen during replay-vs-regen classification.
- `cwd` — the PR-branch worktree if one exists, else the repo root.

## Local environment readiness

Before anything else, invoke [`muggle-test-prepare`](../muggle-test-prepare/SKILL.md) — the readiness/service-start owner (idempotent; halt on what it surfaces). The URL gate below only *selects* the target; prepare is what guarantees something is listening and compiled.

## Pre-flight question — Local URL (gated by `autoSelectLocalHost`)

Skill responsibilities (the rest is in `preference-gates/autoSelectLocalHost.md`):
- **Read the cache**: `Muggle Test Last Host: <url>` session-context line, or `muggle-local-last-host-get`. Pass as `{lastHost}` substitution.
- **Auto-detect a suggested URL**: `lsof -iTCP -sTCP:LISTEN -nP | grep -E ':(3000|3001|4200|5173|8080)'`. Pass as `{suggestedHost}`.
- **Save the cache**: call `muggle-local-last-host-set` after the user picks (the gate file requires this on every pick).

Gate `autoSelectLocalHost` per `preference-gates/README.md` + `preference-gates/autoSelectLocalHost.md`.

## Pre-flight visibility (gated by `showElectronBrowser`)

Gate `showElectronBrowser` (per `preference-gates/README.md`). Resolve once; apply same `showUi` to every test case.
- `always` → omit `showUi` (defaults visible).
- `never` → pass `showUi: false`.
- `ask` → run Picker 1 from `preference-gates/showElectronBrowser.md` via `AskUserQuestion`; map the answer back to one of the actions above.

## Run the dev loop

Execute each test case via the shared loop in [`../_shared/dev-loop/run.md`](../_shared/dev-loop/run.md): [sequential replay/regen](../_shared/dev-loop/run.md), [`actionScript` as-is](../_shared/dev-loop/action-script.md), [`freshSession`](../_shared/dev-loop/fresh-session.md), and [`timeoutMs`](../_shared/dev-loop/timeouts.md).

Caller glue:
- `mode` per test case is the input from the router; `localUrl` from the pre-flight question; `showUi` from the `showElectronBrowser` resolution.
- `cwd` is the input from the router — it drives the cross-worktree single-flight lock so concurrent muggle-test runs from different branches serialize.
- On a failed run, continue the batch; the router routes failures through the debug path after this path returns.

## Collect results

Fetch every `runId` per [`../_shared/dev-loop/failures.md`](../_shared/dev-loop/failures.md), reading structured fields and [interpreting failures](../_shared/dev-loop/failures.md) — never `execute`'s stdout tail. Issue the `muggle-local-run-result-get` calls in parallel; use `Error` as the headline for failures. The studio already published each run, so the same call surfaces `viewUrl` / `cloudTestScriptId` / `cloudActionScriptId` — retain them per [`../_shared/dev-loop/publish.md`](../_shared/dev-loop/publish.md) for the dashboard and walkthrough.

## Report summary

```
Test Case                  Status    Duration   Steps   View Steps on Muggle AI
─────────────────────────────────────────────────────────────────────────
Login with valid creds     PASSED    12.3s      8       https://www.muggle-ai.com/...
Login with invalid creds   PASSED    9.1s       6       https://www.muggle-ai.com/...
Checkout flow              FAILED    15.7s      12      https://www.muggle-ai.com/...
─────────────────────────────────────────────────────────────────────────
Total: 3 tests | 2 passed | 1 failed | 37.1s
```

For failures, don't hand-write a verdict — the router routes each through the debug path.

## Output

Return the uniform runs list the router consumes: `[{ testCaseId, mode, runId, status, viewUrl?, cloudTestScriptId?, cloudActionScriptId? }]`. The studio published each run during execution, so `viewUrl` / `cloudTestScriptId` / `cloudActionScriptId` come straight off the run result (`muggle-local-run-result-get`).
