# Autonomous Development Cycle — Design Spec

**Date:** 2026-03-20
**Status:** Draft

---

## Overview

A fully autonomous development cycle that takes a conversational requirement from the user and produces reviewed PRs across one or more repositories. The system is a **workflow with agent nodes**: the workflow controls sequencing, branching, and retry logic; agents handle LLM reasoning within each stage.

The cycle ends when all PRs are opened and QA has passed (default). A human does the final review and merge.

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
```

---

## Data Contracts

### TaskSpec — Requirements → Impact Analysis
```ts
interface TaskSpec {
  goal: string;
  acceptanceCriteria: string[];
  repos: string[];           // user-hinted affected repos
}
```

### ChangePlan — Impact Analysis → Coding
```ts
interface ChangePlan {
  perRepo: {
    repo: string;
    changes: string[];       // human-readable descriptions
    files: string[];         // specific files to modify
  }[];
}
```

### CodeResult — Coding → Unit Tests
```ts
interface CodeResult {
  perRepo: {
    repo: string;
    branch: string;          // worktree branch with changes
    diff: string;            // summary of changes made
  }[];
}
```

### TestManifest — Test Scope → QA Agent
```ts
interface TestManifest {
  useCases: string[];
  testCases: string[];
  skipReason?: string;       // why other tests were excluded
}
```

### QAReport — QA Agent → Retry loop / PR opener
```ts
interface QAReport {
  passed: string[];
  failed: {
    testCase: string;
    reason: string;
    repro: string;
  }[];
  retryCount: number;
}
```

---

## Agents

| Agent | Package | Responsibility | Key Tools |
|---|---|---|---|
| `requirements-agent` | `packages/agents` | Conversational loop until `TaskSpec` confirmed | Claude API |
| `impact-analysis-agent` | `packages/agents` | Reads all repos, produces `ChangePlan` | File system, git |
| `coding-agent` | `packages/agents` | One per repo (parallel), implements changes in git worktree | File system, git, Claude API |
| `unit-test-runner` | `packages/agents` | Runs test suite per repo, returns pass/fail | Shell |
| `env-setup-agent` | `packages/agents` | Reads service configs, starts required services | `@muggleai/mcp` local tools |
| `test-scope-agent` | `packages/agents` | Reasons over change plan + test definitions → `TestManifest` | Claude API, file system |
| `qa-agent` | `packages/agents` | Executes `TestManifest` against live env → `QAReport` | `@muggleai/mcp` QA tools |
| `pr-agent` | `packages/agents` | Opens one PR per repo with task + QA context | git, GitHub API |

Workflow definition lives in `packages/workflows`. The runner lives in `apps/workflows-runner`.

---

## Retry & Error Handling

| Scenario | Behavior |
|---|---|
| Unit tests fail | Re-invoke `coding-agent` with test output, retry from stage 3 |
| QA issues found | Re-invoke `coding-agent` with `QAReport`, retry from stage 3, increment `retryCount` |
| Max retries exceeded | Halt, report to user — no PRs opened |
| Service fails to start | Halt at stage 5, report which service failed |
| Coding agent fails on one repo | Mark that repo failed, others continue; skip PR for failed repo |

---

## Configuration

```ts
interface WorkflowConfig {
  repos: {
    name: string;
    path: string;
    testCommand: string;
  }[];
  maxRetries: number;        // default: 3
  qaTimeout: number;         // default: 10 min (ms)
  requireQAPass: boolean;    // default: true — halts if QA doesn't pass
}
```

---

## Codebase Mapping

| Concern | Location |
|---|---|
| Workflow DAG definition | `packages/workflows/src/` |
| All agents | `packages/agents/src/` |
| Muggle AI MCP tools (QA + local) | `packages/mcps/src/` |
| Workflow runner / entrypoint | `apps/workflows-runner/src/` |
| Per-project config | Each repo root or central config file |
