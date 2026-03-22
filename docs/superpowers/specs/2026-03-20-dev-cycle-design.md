# Autonomous Development Cycle — Design Spec

**Date:** 2026-03-20
**Status:** Draft

> **Architecture Update (2026-03-22):** Implementation has moved from TypeScript agent classes to Claude Code skills. The orchestrator is at `.claude/commands/muggle-do.md` (invoked as `/muggle-do`), agent skills are at `.claude/skills/muggle-do/*.md`. The `packages/agents` and `apps/workflows-runner` packages have been removed. `packages/workflows/contracts.ts` remains as the canonical type reference. See `docs/superpowers/plans/2026-03-22-skill-based-dev-cycle.md` for the implementation plan.

---

## Overview

A fully autonomous development cycle that takes a conversational requirement from the user and produces reviewed PRs across one or more repositories. The system is a **workflow with agent nodes**: the workflow controls sequencing, branching, and retry logic; agents handle LLM reasoning within each stage.

The cycle ends when all PRs are opened and QA has passed. A human does the final review and merge.

---

## Stages

```
[1] Requirements       ← conversation with user
        ↓
[2] Impact Analysis    ← reads all repo structures, produces per-repo change plan
        ↓
[3] Coding             ← parallel agents, one per affected repo (git worktrees)
        ↓
[4] Unit Tests         ← runs per-repo test suites, must all pass
        ↓
[5] Env Setup          ← service discovery + spin up required services
        ↓
[6] Test Scope         ← analyzes change plan → defines impacted use cases/test cases
        ↓
[7] QA Agent           ← runs scoped test cases via Muggle AI MCP tools
        ↓ issues?
    → back to [3] with QA report (max N retries, then halt)
        ↓ pass
[8] Open PRs           ← one PR per affected repo, linked together
        ↓
[9] Teardown           ← stop all services started in stage 5
```

---

## Data Contracts

### TaskSpec — Requirements → Impact Analysis
```ts
interface TaskSpec {
  goal: string;
  acceptanceCriteria: string[];
  hintedRepos: string[];         // user-suggested repos; Impact Analysis may expand or override
}
```

### ChangePlan — Impact Analysis → Coding
```ts
interface ChangePlan {
  resolvedRepos: string[];       // authoritative list; if hintedRepos diverges, user is notified
  perRepo: {
    repo: string;
    changes: string[];           // human-readable descriptions
    files: string[];             // specific files to modify
    requiredForQA: boolean;      // if true, a coding failure on this repo halts the entire workflow
  }[];
}
```

### CodeResult — Coding → Unit Tests
```ts
interface CodeResult {
  perRepo: {
    repo: string;
    branch: string;              // worktree branch with changes
    diff: string;                // summary of changes made
    status: 'success' | 'failed';
    error?: string;              // populated if status === 'failed'
  }[];
}
```

### UnitTestResult — Unit Tests → retry / Env Setup
```ts
interface UnitTestResult {
  perRepo: {
    repo: string;
    passed: boolean;
    output: string;              // raw test runner output for coding-agent context on retry
    failedTests: string[];
  }[];
}
```

### TestManifest — Test Scope → QA Agent
```ts
interface TestCaseRef {
  id: string;                    // MCP tool-compatible test case ID
  useCase: string;               // human-readable use case label
  description: string;
}

interface TestManifest {
  testCases: TestCaseRef[];
  skipReason?: string;           // why other tests were excluded
}
```

### EnvState — Env Setup → QA retries + Teardown
```ts
interface ServiceHandle {
  name: string;
  pid?: number;                  // process ID if started locally
  containerId?: string;          // container ID if started via Docker
  stopCommand?: string;          // fallback shell command to stop the service
}

interface EnvState {
  services: ServiceHandle[];
}
```

> **Note:** `EnvState` is produced once at stage 5 and held by the workflow for the duration of all retry iterations. Stage 5 does **not** re-run on retries — the environment stays up across the retry loop (stages 3–7). Teardown happens only at stage 9 (success path) or on halt after max retries exceeded.

### QAReport — QA Agent → retry loop / PR opener
```ts
interface QAReport {
  passed: TestCaseRef[];
  failed: {
    testCase: TestCaseRef;
    reason: string;
    repro: string;
  }[];
}
```

> **Note:** `retryCount` is owned by the **workflow**, not by `QAReport`. On retry, the workflow passes `retryCount` as a direct call argument to the `coding-agent` alongside the failure context (`UnitTestResult` or `QAReport`). It is not part of any typed artifact.

### PRInput — Workflow → PR Agent
```ts
interface PRInput {
  taskSpec: TaskSpec;
  changePlan: ChangePlan;
  codeResult: CodeResult;        // pr-agent filters to repos where status === 'success'
  qaReport: QAReport;            // always included; used to flag [QA FAILING] if requireQAPass: false
}
```

---

## Agents

| Agent | Package | Responsibility | Key Tools |
|---|---|---|---|
| `requirements-agent` | `packages/agents` | Conversational loop until `TaskSpec` confirmed | Claude API |
| `impact-analysis-agent` | `packages/agents` | Reads all repos, resolves affected repos, produces `ChangePlan` | File system, git |
| `coding-agent` | `packages/agents` | One per repo (parallel), implements changes in git worktree | File system, git, Claude API |
| `unit-test-runner` | `packages/agents` | Runs test suite per repo, returns `UnitTestResult` | Shell |
| `env-setup-agent` | `packages/agents` | Reads service configs, starts required services, returns `EnvState` for teardown | `@muggleai/mcp` local tools |
| `test-scope-agent` | `packages/agents` | Reasons over change plan + test definitions → `TestManifest` with typed `TestCaseRef` IDs | Claude API, file system |
| `qa-agent` | `packages/agents` | Executes `TestManifest` against live env using MCP tool IDs → `QAReport` | `@muggleai/mcp` QA tools |
| `pr-agent` | `packages/agents` | Opens one PR per repo where `CodeResult.perRepo[repo].status === 'success'`, with task + QA context | git, GitHub API |

Workflow definition lives in `packages/workflows`. The runner lives in `apps/workflows-runner`.

---

## Retry & Error Handling

| Scenario | Behavior |
|---|---|
| Unit tests fail | Workflow re-invokes `coding-agent` with `UnitTestResult.output` as context, retries from stage 3 (increments `retryCount`) |
| QA issues found | Workflow re-invokes `coding-agent` (only repos with failed tests) with `QAReport` as context, retries from stage 3 (increments `retryCount`) |
| Max retries exceeded | If stage 5 was reached at least once: teardown services. Halt and report to user — no PRs opened (unless `requireQAPass: false`, see below). |
| Service fails to start | Halt at stage 5, teardown any partially started services, report which service failed. |
| Coding agent fails on one repo | Mark repo as failed in `CodeResult`. If `ChangePlan.perRepo[repo].requiredForQA` is true, halt and report — stage 5 has not run yet, so no teardown is needed. If false, continue with remaining repos — QA runs on the partial set, PRs opened only for repos where `CodeResult.perRepo[repo].status === 'success'`. User is notified of the skipped repo. |
| `requireQAPass: false` | Retries still run up to `maxRetries`. After max retries are exhausted, PRs are opened anyway (teardown runs first). Each PR description includes the full `QAReport` and is flagged `[QA FAILING]` in the title. Unit test failures still halt regardless of this flag. |

---

## Authentication

The Muggle AI QA tools (`@muggleai/mcp`) require authenticated sessions. The workflow:

1. Checks for valid credentials in `~/.muggle-ai/credentials.json` lazily at the **start of stage 5** (not before), so auth is never triggered if stage 5 is never reached (e.g., all coding agents fail on non-`requiredForQA` repos)
2. If missing or expired, invokes the device code auth flow (browser window) before proceeding
3. Refreshes the token automatically if the refresh token is still valid
4. If auth fails, halts the workflow and reports to the user before any QA work is attempted

Credentials are never passed through data contracts — the `qa-agent` and `env-setup-agent` read them directly from the credentials store via `@muggleai/mcp` shared auth utilities.

---

## Configuration

```ts
interface WorkflowConfig {
  repos: {
    name: string;
    path: string;
    testCommand: string;
  }[];
  maxRetries: number;        // default: 3 — single shared counter; any retry from stage 3 (whether triggered by unit test failure or QA failure) consumes one slot
  qaTimeout: number;         // default: 600000 (10 min, in ms)
  requireQAPass: boolean;    // default: true — halt if QA doesn't pass after max retries
}
```

---

## Workflow Runtime

`packages/workflows` and `apps/workflows-runner` are currently empty placeholders. This spec treats the workflow DAG as **code** — a typed TypeScript graph defined in `packages/workflows/src/` and executed by a lightweight custom runner in `apps/workflows-runner/src/`. No external workflow framework is assumed. The runner:

- Executes nodes in dependency order (parallel where possible)
- Passes typed artifacts between nodes
- Owns `retryCount` state
- Handles all branching logic (test failure → retry, QA failure → retry, halt conditions)
- Emits structured logs per stage for observability

This is a greenfield implementation — both packages need to be built as part of this project.

---

## Codebase Mapping

| Concern | Location |
|---|---|
| Workflow DAG definition | `packages/workflows/src/` (new) |
| Workflow runner / executor | `apps/workflows-runner/src/` (new) |
| All agents | `packages/agents/src/` (new) |
| Muggle AI MCP tools (QA + local) | `packages/mcps/src/` (existing) |
| Per-project config | Each repo root or central config file |
