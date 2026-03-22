# Muggle Do — Autonomous Development Pipeline

You are running the Muggle AI autonomous development cycle. The user has described a task and you will take it through a full pipeline: requirements analysis, change detection, testing, QA, and PR creation.

## Input

The user's task description is: $ARGUMENTS

## Prerequisites

Before starting, verify:
1. The user has configured repos in this project (check for a `muggle-repos.json` in the project root, or ask the user which repos to work with and their local paths)
2. Each repo must be on a feature branch (not main/master)
3. Each repo must have uncommitted or committed changes on the feature branch

## Pipeline

Execute these stages in order. Pass results between stages as described. If any stage fails, report the error clearly and stop.

### Stage 1: Requirements Analysis

Spawn an Agent with the prompt from `.claude/skills/muggle-do/requirements.md`.

Pass it: the user's task description ($ARGUMENTS) and the list of configured repos.

Collect: a structured requirements summary (goal, acceptance criteria, list of repos to check).

### Stage 2: Impact Analysis

Spawn an Agent with the prompt from `.claude/skills/muggle-do/impact-analysis.md`.

Pass it: the requirements from Stage 1 and the repo paths.

Collect: which repos have actual changes, what files changed, what the changes do.

If no repos have changes, stop and tell the user: "No changes detected. Make your code changes first, then run /muggle-do again."

### Stage 3: Validate Code State

Spawn an Agent with the prompt from `.claude/skills/muggle-do/validate-code.md`.

Pass it: the list of changed repos and their paths.

Collect: per-repo branch name, diff summary, validation that each repo is on a feature branch.

If any repo is on main/master, stop and tell the user to create a feature branch.

### Stage 4: Unit Tests

Spawn an Agent with the prompt from `.claude/skills/muggle-do/unit-tests.md`.

Pass it: the list of changed repos, their paths, and their test commands.

Collect: pass/fail per repo with test output.

**FAIL FAST:** If any repo's tests fail, stop immediately. Show the user the failure output and tell them to fix the tests before running /muggle-do again. Do NOT proceed to QA.

### Stage 5: QA

Spawn an Agent with the prompt from `.claude/skills/muggle-do/qa.md`.

Pass it: the project ID, the changed repos and files, the requirements goal.

Collect: QA report with passed/failed test cases.

If QA fails and the user hasn't set `requireQAPass: false` in their config, stop and report failures. The PRs should NOT be opened with failing QA unless the user explicitly opts in.

### Stage 6: Open PRs

Spawn an Agent with the prompt from `.claude/skills/muggle-do/open-prs.md`.

Pass it: per-repo branch names, the requirements goal, acceptance criteria, the QA report.

Collect: PR URLs.

### Stage 7: Report

Present the final results to the user:
- List of PRs opened (with URLs)
- QA summary (passed/failed counts)
- Any warnings or issues encountered

## Error Handling

- If a stage fails, report the error and stop (do not silently continue)
- Always show which stage failed and why

## Configuration

The orchestrator reads repo config from `muggle-repos.json` in the project root:

```json
[
  { "name": "frontend", "path": "/absolute/path/to/frontend", "testCommand": "pnpm test" },
  { "name": "backend", "path": "/absolute/path/to/backend", "testCommand": "pnpm test" }
]
```

If this file doesn't exist, ask the user to provide repo details interactively before proceeding.
