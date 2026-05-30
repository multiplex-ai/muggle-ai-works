# E2E Acceptance Agent (Stage 6)

You are executing E2E acceptance validation for the muggle-do cycle.

Stage 6 of `muggle-do`. Runs browser acceptance tests against code changes and records evidence for downstream PR rendering.

Standalone subagent (different invocation path, used by `muggle-test` Mode C): [`../../agents/acceptance-tester.md`](../../agents/acceptance-tester.md).

## Turn preamble

Start the turn with:

```
**Stage 6 — E2E acceptance** — running browser tests against the validation target from pre-flight.
```

## Design

This stage is **mode-driven by pre-flight**:

- `local-e2e` runs the local browser flow (`test-feature-local` approach).
- `unit-only` or `skip` does not execute browser runs and must emit an explicit non-pass verdict (`SKIPPED` / `UNIT-ONLY` equivalent in downstream reporting).
- `staging-replay` is not executed in this stage path and should be surfaced as `INCONCLUSIVE` unless the caller has already routed to a dedicated staging runner.

For local runs, the tool boundaries are:

| Scope | MCP tools |
| :---- | :-------- |
| Cloud (projects, cases, scripts, auth) | `muggle-remote-*` |
| Local (Electron run, publish, results) | `muggle-local-*` |

This keeps execution deterministic: local runs do not depend on cloud replay execution availability.

## Input

You receive everything from `state.md` already — pre-flight resolved it:

- `localUrl` — the running validation target URL (typically localhost in local mode)
- `projectId` — the chosen Muggle Test project
- The validation strategy (`local-e2e`, `staging-replay`, `unit-only`, `skip`)
- Test-user credential status (existing / new / skip), when credentials are needed
- The list of changed repos, files, and a summary of changes
- The requirements goal

## Your Job

### Step 0: Consume the validation context (no user questions)

Read `state.md`.

**No `## Pre-flight answers` block at all** → the session was seeded poll-only (e.g. by auto-track, [`../muggle-pr-followup/auto-track.md`](../muggle-pr-followup/auto-track.md)). Treat `Validation` as `skip`: emit a `SKIPPED` report with reason `no validation context seeded` and exit cleanly. The watcher owns no E2E context by design; "no context" is a clean skip, not a failure.

Otherwise the block was seeded by pre-flight or bootstrap per [`../_shared/resolve-e2e-validation-context.md`](../_shared/resolve-e2e-validation-context.md) — read it the same way regardless of seeder. The persisted `Validation` field (`local-e2e`, `staging-replay`, `unit-only`, `skip`) picks execution vs early-exit below. In a forward run, [`autoE2ETest`](../muggle-preferences/preference-gates/autoE2ETest.md) `ask` was resolved by pre-flight Q13; in a watcher cycle there is no per-tick pre-flight, so `Validation` **is** the standing decision — don't re-resolve `ask`.

For a `local-e2e` block, use `localUrl`, `projectId`, and the working-tree path from `state.md`. Missing any → seeding bug; escalate with the session path and halt; do not ask the user.

### Step 0.5: Pre-flight verification probes

Before launching the local runner:

1. **Dev-server + backend readiness** — per [`../_shared/dev-server-readiness.md`](../_shared/dev-server-readiness.md) (port + compile log + backend health). Halt on any failure.
2. **Auth** — `muggle-remote-auth-status` must be `authenticated`; else escalate.
3. **Identity tenant/domain match** — if test credentials were marked `existing`, confirm the repo's configured identity tenant/domain matches the recorded tenant/domain. Mismatch → halt.

### Step 1: Authentication already verified

Pre-flight handled auth. If `muggle-remote-auth-status` somehow shows expired here (session clock skew, etc.), re-auth silently via `muggle-remote-auth-login` + `muggle-remote-auth-poll` — but do not ask the user "continue with this account?" again.

If validation is `unit-only` or `skip`, emit a `SKIPPED` report with a one-line reason and exit cleanly.

If validation is `staging-replay`, emit `INCONCLUSIVE` with reason `staging replay not handled in Stage 6 local runner path` and exit cleanly.

### Step 1.5: Placeholder branch detection

Read `pathClassification` from the impact-analysis output (emitted by `do/impact-analysis.md`). If it is `none` — i.e. `git diff <default-branch>...HEAD --stat` was empty after rebase — there is no code under test and running test cases would only re-test master. Write a one-paragraph SKIPPED result to the E2E report (or return a SKIPPED verdict to the caller) and exit the stage cleanly. **Do not** synthesize test cases or run anything.

### Step 1.7: Route + project classification

Consume `pathClassification` from impact-analysis and resolve the dispatch target:

- `surface-a` → use the classification-specific route + project mapping defined by impact-analysis output
- `surface-b` → use the classification-specific route + project mapping defined by impact-analysis output
- `mixed` → run once per classification mapping (route + project), or surface as INCONCLUSIVE if running both is over the wall-time budget
- `none` → already handled in Step 1.5

The `devServerUrl` and project resolved here override any defaults in `state.md` for the remainder of this stage. Treat classification labels as routing hints provided by impact-analysis; do not hardcode product-specific paths in this stage.

### Step 2: Get Test Cases

Use `muggle-remote-test-case-list` with the project ID to fetch all test cases.

### Step 3: Filter Relevant Test Cases

Based on the changed files and the requirements goal, determine which test cases are relevant:
- Test cases whose use cases directly relate to the changed functionality
- Test cases that cover areas potentially affected by the changes
- When in doubt, include the test case (better to over-test than miss a regression)

### Step 4: Run the loop, publish, gather screenshots

For each relevant test case, run the shared loop in [`../_shared/dev-loop/run.md`](../_shared/dev-loop/run.md): `muggle-remote-test-script-list` by `testCaseId` to pick [replay vs regen](../_shared/dev-loop/run.md), [execute with `timeoutMs`](../_shared/dev-loop/timeouts.md), [fetch the result](../_shared/dev-loop/failures.md) and [interpret failures](../_shared/dev-loop/failures.md), [publish](../_shared/dev-loop/publish.md), and gather [per-step screenshots](../_shared/dev-loop/publish.md).

Inputs to the loop: `mode` from the script-exists check, `localUrl`/project from Step 1.7, `cwd` = the working tree recorded in `state.md`.

### Step 7: Collect Results

For each test case:
- Record pass or fail from the run result
- If failed, capture the error message, failure step index, and `artifactsDir` for local debugging
- In `local-e2e` mode, every relevant test case must be executed — generate a new script if none exists (no skips)

## Output

**E2E acceptance report:**

**Passed:** (count)
- (test case name):
  - testCaseId: `<id>`
  - testScriptId: `<id>`
  - runId: `<id>`
  - viewUrl: `<url>`
  - steps: `[{ stepIndex, action, screenshotUrl }, ...]`

**Failed:** (count)
- (test case name):
  - testCaseId: `<id>`
  - testScriptId: `<id>`
  - runId: `<id>`
  - viewUrl: `<url>`
  - failureStepIndex: `<index>`
  - error: `<message>`
  - steps: `[{ stepIndex, action, screenshotUrl }, ...]`
  - artifactsDir: `<path>` (for local debugging)

**Inconclusive:** (count) — use for runs that couldn't yield a pass/fail signal: no replayable script, environment precondition unmet, infra error, agent stalled on auth/cookie banner before reaching the assertion, missing secrets. The product is **not** implicated — that's `failed`, not `inconclusive`.
- (test case name):
  - testCaseId: `<id>`
  - runId: `<id>` (synthesize a UUID if no run started)
  - viewUrl: `<url>` (project-level run-results fallback when no specific run URL exists)
  - reason: `<one short sentence>`
  - steps: `[{ stepIndex, action, screenshotUrl }, ...]` (may be empty)

**Metadata:**
- projectId: `<projectId>`

**Overall:** PASS | FAIL | PARTIAL | INCONCLUSIVE | BLOCKED | SKIPPED — see [`../_shared/failure-mode-handling.md`](../_shared/failure-mode-handling.md) section F for the canonical taxonomy.

## Hard constraints

- **Do NOT shut down the dev server.** The caller manages dev-server lifecycle.
- **Do NOT delete or move workspace config/state files** (for example `.muggle-ai/`, `.env.local`, or equivalent runtime config artifacts) in the worktree.
- **Do NOT call destructive remote MCP tools** — no `*-delete`, `*-revoke`, `*-cancel`, or `*-update` against remote-owned definitions.
- **One replacement script generation max per stage cycle.**
- **Honor `wallTimeBudgetSec` from the caller** — on approach, write a PARTIAL report; never silently exceed.

## Non-negotiables

- No silent auth skip; always verify with `muggle-remote-auth-status` first.
- Replay/timeout/result discipline per [`../_shared/dev-loop/run.md`](../_shared/dev-loop/run.md) — never hand-build `actionScript`, always pass `timeoutMs`, read structured run-result fields.
- No hiding failures: surface errors, exit codes, and artifact paths.
- In `local-e2e` mode, every relevant test case must be executed — generate a new script if none exists (no skips).
- Always publish after execution to ensure screenshots are cloud-accessible for PR comments.
- **Never drop a test case from the report because it "couldn't run cleanly."** A test that didn't reach its assertion is `inconclusive`, not absent. Dropping it produces misleading verdicts and pushes downstream PR-comment renderers to hand-write the comment — which is the failure mode this stage exists to prevent.
