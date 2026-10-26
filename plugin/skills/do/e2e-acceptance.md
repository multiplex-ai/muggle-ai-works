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

**Every SKIPPED exit from this stage** (Step 0 poll-only, Step 1 `unit-only`/`skip`, Step 1.5 placeholder branch) also runs `echo "MUGGLE_E2E_SKIP: <CODE>: <detail>"` as a single Bash call before exiting — it records the skip in guardrail session state so the Stop-hook E2E gate releases instead of blocking the turn.

`<CODE>` is one of `NO_WEB_SURFACE`, `DEV_SERVER_UNREACHABLE`, `EMPTY_DIFF`, `MUGGLE_AUTH_DOWN`, `NO_PR`, `USER_WAIVED`, `NO_APP_LOGIC_CHANGE`, `NOT_APPLICABLE` — the one list of skip codes, which other files reference rather than restate — and the guardrail checks it before the gate releases. Every code but `NOT_APPLICABLE` names a fact the guardrail checks for itself, about the environment or about which paths a commit range touched. "Static page", "layout only", "unit tests cover it" and "verified with another tool" are not reasons E2E cannot apply — cite a code that holds, or run the tests. `USER_WAIVED` needs the user's own literal `SKIP E2E` in the transcript, never an inferred go-ahead. A rejected declaration is answered with the check that failed, and the turn stays blocked.

`NOT_APPLICABLE` is the last resort, for a change no browser run can exercise and no verifiable code covers — an email template, a backend path the UI never reaches, a scheduled job. Its detail is the reason, in at least four words, and the PR's walkthrough comment shows that reason as the agent's own judgment, marked unverified, for the reviewer to accept or push back on. Never cite it to avoid a run that could happen.

`NO_APP_LOGIC_CHANGE` belongs to a watcher cycle's minor tail ([`cycle-size.md`](cycle-size.md)), never to a Stage 6 exit. Its detail opens with the cycle's starting commit. Muggle diffs that commit against HEAD and accepts only when every changed path is docs (`*.md`, `*.markdown`, `*.rst`), tests (`*.test.*`, `*.spec.*`, `__tests__/`, `__snapshots__/`, `__mocks__/`, `test_*.py`, `*_test.py`, `*_test.go`, a root-level `test/` or `tests/`), lint/format config (ESLint, Prettier, Stylelint and markdownlint config or ignore files, `biome.json`, `.editorconfig`), or CI config (`.github/workflows/`, `.gitlab-ci.yml`). A commit it cannot resolve, an empty diff, or any other path — a comment-only edit in a source file included — fails.
- `staging-replay` is not executed in this stage path and should be surfaced as `INCONCLUSIVE` unless the caller has already routed to a dedicated staging runner.

For local runs, the tool boundaries are:

| Scope | MCP tools |
| :---- | :-------- |
| Cloud (projects, cases, scripts, auth) | `muggle-remote-*` |
| Local (Electron run, results — the studio publishes during the run) | `muggle-local-*` |

This keeps execution deterministic: local runs do not depend on cloud replay execution availability.

## Input

You receive everything from `state.md` already — pre-flight resolved it:

- `localUrl` — the running validation target URL (typically localhost in local mode)
- `projectId` — the chosen Muggle Test project
- The validation strategy (`local-e2e`, `staging-replay`, `unit-only`, `skip`)
- Test-user credential status (existing / new / skip), when credentials are needed
- The list of changed repos, files, and a summary of changes
- The requirements goal
- The `e2eScope` from impact analysis — the impacted, retired, and new use cases and test cases this stage runs

## Your Job

### Step 0: Consume the validation context (no user questions)

Read `state.md`.

**No `## Pre-flight answers` block at all** → the session was seeded poll-only (e.g. by auto-track, [`../muggle-pr-followup/auto-track.md`](../muggle-pr-followup/auto-track.md)). Treat `Validation` as `skip`: emit a `SKIPPED` report citing `NO_PR` and exit cleanly. The watcher owns no E2E context by design; "no context" is a clean skip, not a failure.

Otherwise the block was seeded by pre-flight or bootstrap per [`../_shared/resolve-e2e-validation-context.md`](../_shared/resolve-e2e-validation-context.md) — read it the same way regardless of seeder. The persisted `Validation` field (`local-e2e`, `staging-replay`, `unit-only`, `skip`) picks execution vs early-exit below. In a forward run, [`autoE2ETest`](../muggle-preferences/preference-gates/autoE2ETest.md) `ask` was resolved by pre-flight Q13; in a watcher cycle there is no per-tick pre-flight, so `Validation` **is** the standing decision — don't re-resolve `ask`.

For a `local-e2e` block, use `localUrl`, `projectId`, and the working-tree path from `state.md`. Missing any → seeding bug; escalate with the session path and halt; do not ask the user.

### Step 0.4: Wave cycles

`state.md` records `Wave: on` → this stage runs **once for the whole wave**, not per repo, per [`wave-e2e.md`](wave-e2e.md): the wave stack starts from every member's worktree, test cases are selected against the union of diffs, each case runs once, and each failure names its `implicatedRepo`. The steps below apply with those changes.

### Step 0.45: Background lane

When other work is in front of the session as this change reaches Stage 6, the main session runs none of the steps below: it records `E2E lane: background`, queues the change, and dispatches a background `acceptance-tester` to execute them per [`background-e2e.md`](background-e2e.md). Executing as that agent, follow its rules — in particular, a `SKIPPED` exit returns its code in the report and runs no `MUGGLE_E2E_SKIP` echo; the main session declares it from the PR's worktree once the report returns.

### Step 0.5: Readiness check

A `local-e2e` cycle runs these before any `muggle-local-execute-*` call, every cycle — even when pre-flight already reported the app ready, since a server can die while stages 2–5 run and a healthy one fast-exits:

1. **Dev-server + backend readiness** — invoke [`muggle-test-prepare`](../muggle-test-prepare/SKILL.md) from the cycle's worktree, passing the PR target as `base` — the readiness/service-start owner (idempotent fast-exit when healthy; probes via `dev-server-readiness.md` and starts what is down). It syncs the worktree onto the latest base before starting anything, and serves every other repo from its latest default branch. Its readiness table must show the cycle's worktree as the `Source` of the changed repo's services, at the worktree's current HEAD; any other source is not ready. Still not ready after its start attempts → the readiness halt below.
2. **Auth** — `muggle-remote-auth-status` must be `authenticated`; else escalate.
3. **Identity tenant/domain match** — if test credentials were marked `existing`, confirm the repo's configured identity tenant/domain matches the recorded tenant/domain. Mismatch → halt.

**Readiness halt.** The cycle planned a browser run and still owes it, so an app that cannot be brought up halts the cycle and is never a `SKIPPED` exit: declare no skip code, write no waiver, run nothing downstream. Report the URL probed, what `muggle-test-prepare` tried (the start command and how it failed), and that no PR was opened or updated; then end the turn and wait for the user. This holds for unattended runs and for a request that asked for the PR. A forward cycle opens no PR, posts no walkthrough, runs no Stage 7.5 and arms no watcher; a watcher cycle pushes nothing and escalates through its own path, which keeps the watcher running. A run that failed because the app never answered (connection refused, page never loaded) returns to item 1, and still down is this halt. A Stop-hook reminder that E2E is still owed does not lift it.

### Step 1: Authentication already verified

Pre-flight handled auth. If `muggle-remote-auth-status` somehow shows expired here (session clock skew, etc.), re-auth silently via `muggle-remote-auth-login` + `muggle-remote-auth-poll` — but do not ask the user "continue with this account?" again.

If validation is `unit-only` or `skip`, emit a `SKIPPED` report citing the code that holds — `NO_WEB_SURFACE` when the repo has nothing to drive, `DEV_SERVER_UNREACHABLE` when it does but nothing answers — and exit cleanly. This is the only exit `DEV_SERVER_UNREACHABLE` belongs to, because pre-flight never planned a browser run; on a `local-e2e` cycle an unreachable server is the Step 0.5 readiness halt.

If validation is `staging-replay`, emit `INCONCLUSIVE` with reason `staging replay not handled in Stage 6 local runner path` and exit cleanly.

### Step 1.5: Placeholder branch detection

Read `pathClassification` from the impact-analysis output (emitted by `do/impact-analysis.md`). If it is `none` — i.e. `git diff <default-branch>...HEAD --stat` was empty after rebase — there is no code under test and running test cases would only re-test master. Write a SKIPPED result citing `EMPTY_DIFF` to the E2E report (or return that verdict to the caller) and exit the stage cleanly. **Do not** synthesize test cases or run anything.

### Step 1.7: Route + project classification

Consume `pathClassification` from impact-analysis and resolve the dispatch target:

- `surface-a` → use the classification-specific route + project mapping defined by impact-analysis output
- `surface-b` → use the classification-specific route + project mapping defined by impact-analysis output
- `mixed` → run once per classification mapping (route + project), or surface as INCONCLUSIVE if running both is over the wall-time budget
- `none` → already handled in Step 1.5

The `devServerUrl` and project resolved here override any defaults in `state.md` for the remainder of this stage. Treat classification labels as routing hints provided by impact-analysis; do not hardcode product-specific paths in this stage.

### Step 2: Load the scope

The cases to run are the `e2eScope` impact analysis recorded in its `iterations/<NNN>.md` marker ([`impact-analysis.md`](impact-analysis.md#output-state--e2escope)): every impacted test case plus every new one. Do not re-list the project or re-select by judgment here; the scope was decided where the diff and the criteria were both in hand.

- **No scope, or `not-scoped`, on a cycle that reached this step** → run that file's scope procedure now and record it before going on. Never fall back to every case in the project.
- **A Stage 7.5 re-run** passes its affected test cases; they replace the scope for that run, and cases already created are not created again.
- **Retired use cases and test cases** are not run — the change replaced or removed what they verify. Nothing is deleted here: the report lists them as planned deletions, and [`cleanup.md`](cleanup.md) deletes them once the PR merges.
- **A flow the run shows the change reaches that no scoped case covers** is added with a one-line reason under the report's scope amendments. A scoped case is never dropped.

### Step 3: Create the new cases

Create what the scope planned, before any run:

1. **New use cases** — one `muggle-remote-use-case-create-from-prompts` call with every `newUseCases` instruction in its `instructions` array. Map each created use case back to its key.
2. **New test cases** — one `muggle-remote-test-case-generate-from-prompt` per `newTestCases` entry, all in one message, with `projectId`, the resolved `useCaseId`, and the entry's `instruction`.
3. **Create every generated case** — `muggle-remote-test-case-create` for each, in parallel. Accept the generator's decomposition as-is ([`../_shared/test-case-design.md`](../_shared/test-case-design.md)): N micro-tests from one instruction are N test cases. Record each `testCaseId` against its key; the report and a Stage 7.5 re-run name new cases by id.

A failed create leaves its entry `INCONCLUSIVE` with reason `case creation failed: <error>`; it stays in the report.

### Step 3.5: Satisfy each target's prerequisite chain

For every test case in scope after Step 3, resolve its prerequisite chain from the backend's test-plan graph and make each ancestor ready before the target runs, per [`../_shared/test-case-chain-readiness.md`](../_shared/test-case-chain-readiness.md). This stage is unattended, so follow that file's unattended-caller rule: a target whose chain cannot be satisfied is reported `INCONCLUSIVE` with reason `prerequisites unmet` and is not run.

A target that runs without its prerequisite state spends its step budget re-creating that state — signing in, seeding data — and reports on what it lacked rather than on the change under test. That verdict reads as a product failure and is worth less than no verdict.

Ancestors generated here are prerequisites, not results: they belong in neither the Passed nor the Failed block of the report.

### Step 4: Run the dev loop, gather screenshots

For each scoped test case, run the shared loop in [`../_shared/dev-loop/run.md`](../_shared/dev-loop/run.md): `muggle-remote-test-script-list` by `testCaseId` with `runEnvironmentType: "local"` (this stage runs against localhost) to pick [replay vs regen](../_shared/dev-loop/run.md), [run once per record](../_shared/dev-loop/run.md#records), [execute with `timeoutMs`](../_shared/dev-loop/timeouts.md), [fetch the result](../_shared/dev-loop/failures.md) and [interpret failures](../_shared/dev-loop/failures.md), then read the studio-published [cloud refs and per-step screenshots](../_shared/dev-loop/publish.md) off the run result.

Inputs to the loop: `mode` from the script-exists check, `localUrl`/project from Step 1.7, `cwd` = the working tree recorded in `state.md`.

Each record's run is its own report entry carrying its `runSettingsId` and `resolutionLabel`. A record skipped because its primary failed is an Inconclusive entry with reason `primary failed`, not a skipped test case.

### Step 7: Collect Results

For each test case:
- Record pass or fail from the run result
- If failed, capture the error message, failure step index, and `artifactsDir` for local debugging
- In `local-e2e` mode, every scoped test case must be executed — generate a new script if none exists (no skips)

## Output

**E2E acceptance report:**

**Passed:** (count)
- (test case name):
  - testCaseId: `<id>`
  - runSettingsId: `<id>` (the run result's `cloudRunSettingsId`; omit when absent)
  - resolutionLabel: `<width>×<height>` (the record's size, e.g. `390×844`; omit with `runSettingsId`)
  - testScriptId: `<id>`
  - runId: `<id>`
  - viewUrl: `<url>`
  - steps: `[{ stepIndex, action, description, screenshotUrl }, ...]`

**Failed:** (count)
- (test case name):
  - testCaseId: `<id>`
  - runSettingsId: `<id>`
  - resolutionLabel: `<width>×<height>`
  - testScriptId: `<id>`
  - runId: `<id>`
  - viewUrl: `<url>`
  - failureStepIndex: `<index>`
  - error: `<message>`
  - steps: `[{ stepIndex, action, description, screenshotUrl }, ...]`
  - artifactsDir: `<path>` (for local debugging)

**Inconclusive:** (count) — use for runs that couldn't yield a pass/fail signal: no replayable script, environment precondition unmet, prerequisites unmet (Step 3.5), infra error, agent stalled on auth/cookie banner before reaching the assertion, missing secrets. The product is **not** implicated — that's `failed`, not `inconclusive`.
- (test case name):
  - testCaseId: `<id>`
  - runSettingsId: `<id>`
  - resolutionLabel: `<width>×<height>`
  - runId: `<id>` (synthesize a UUID if no run started)
  - viewUrl: `<url>` (project-level run-results fallback when no specific run URL exists)
  - reason: `<one short sentence>`
  - steps: `[{ stepIndex, action, description, screenshotUrl }, ...]` (empty only when the run produced no steps)

**Scope:** (from `e2eScope`, after Step 3)
- impacted: `<testCaseId>`, ...
- new: `<key>` → `<testCaseId>`, ...
- retired (not run — deleted after merge): use case `<useCaseId>`, ...; test case `<testCaseId>` → replaced by `<testCaseId>` | removed, ...
- amendments: `<testCaseId>` — `<reason>`, ...

**Metadata:**
- projectId: `<projectId>`

**Overall:** PASS | FAIL | PARTIAL | INCONCLUSIVE | BLOCKED | SKIPPED — see [`../_shared/failure-mode-handling.md`](../_shared/failure-mode-handling.md) section F for the canonical taxonomy.

A non-passing verdict does not end the cycle. [`e2e-repair.md`](e2e-repair.md) consumes this report at Stage 7.5 and root-causes every Failed and Inconclusive entry before a watcher is armed, so write those blocks in full — the bucket, failing step, and `artifactsDir` recorded here are that stage's entire input.

Failed runs use the same evidence + diagnosis assembly as the interactive debug path ([`../_shared/debug-failed-run.md`](../_shared/debug-failed-run.md) Steps 1–2) — write that evidence into the **Failed** block above. This stage is autonomous, so it skips Step 3's interactive offer.

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
- In `local-e2e` mode, every scoped test case must be executed — generate a new script if none exists (no skips).
- The studio publishes every run during execution, so screenshots are cloud-accessible for PR comments — read the refs off the run result, never re-publish.
- **Never drop a test case from the report because it "couldn't run cleanly."** A test that didn't reach its assertion is `inconclusive`, not absent. Dropping it produces misleading verdicts and pushes downstream PR-comment renderers to hand-write the comment — which is the failure mode this stage exists to prevent.
