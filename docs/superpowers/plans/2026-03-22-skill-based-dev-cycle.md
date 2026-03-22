# Skill-Based Dev Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the TypeScript agent classes and workflow runner with Claude Code skill files (`.md`) that leverage the existing Muggle MCP tools, so the dev cycle is invoked as `/dev-cycle "task"` inside Claude Code.

**Architecture:** A main orchestrator skill (`.claude/commands/dev-cycle.md`) drives a linear pipeline. Each stage spawns a focused subagent via Claude Code's `Agent` tool, passing it a skill prompt from `.claude/skills/dev-cycle/`. Subagents use built-in tools (Bash, Read, Edit, Glob, Grep) plus Muggle MCP tools (`muggle-remote-*`, `muggle-local-*`) for QA operations. No custom TypeScript runtime — Claude Code IS the runtime.

**Tech Stack:** Claude Code slash commands (`.md`), Agent tool (subagent spawning), Muggle MCP tools (existing `packages/mcps`), `gh` CLI (for PRs), git (for change detection).

---

## v1 Scope Decisions

The following stages from the original spec are **intentionally omitted** in v1:

- **Env Setup / Teardown** — Services (dev servers, databases) are assumed to be managed by the user outside the pipeline. If QA needs a running service, the user starts it before running `/dev-cycle`.
- **Retry loop** — The original spec had a coding→test→QA retry loop (max N retries). In the skill-based model, the user IS the retry loop: they see the failure, fix it, and run `/dev-cycle` again. This is simpler and gives the user control.
- **Test Scope (as separate stage)** — Test case filtering is inlined into the QA skill. The QA agent fetches all test cases and uses judgment to select relevant ones.

---

## Parallelization Guide for Agent Teams

This plan has three phases. Phase 2 tasks are independent and can run in parallel.

```
Phase 1: Orchestrator          (Task 1)      — must complete first
         ↓
Phase 2: Agent Skills          (Tasks 2-7)   — all independent, run in parallel
         ↓
Phase 3: Cleanup + Docs        (Tasks 8-9)   — must complete last
```

---

## File Structure

### New files to create

```
.claude/commands/
  dev-cycle.md                — user-facing slash command: /dev-cycle "add login"

.claude/skills/dev-cycle/
  requirements.md             — subagent: extract goal, acceptance criteria, repos
  impact-analysis.md          — subagent: detect changed repos via git
  validate-code.md            — subagent: verify feature branch + changes exist
  unit-tests.md               — subagent: run test commands per repo
  qa.md                       — subagent: trigger QA via Muggle MCP tools
  open-prs.md                 — subagent: create PRs via gh CLI
```

### Files to keep

```
packages/workflows/src/
  contracts.ts                — canonical data contract types (TaskSpec, ChangePlan, etc.)
  index.ts                    — updated to only export contracts
  test/contracts.test.ts      — kept (tests for contracts that remain)

packages/mcps/                — existing Muggle MCP tools (unchanged)
```

### Files/directories to delete

```
packages/agents/              — entire package (replaced by .claude/skills/dev-cycle/)

apps/workflows-runner/        — entire app (replaced by /dev-cycle slash command)

packages/workflows/src/
  dev-cycle.ts                — orchestration logic moves to .claude/commands/dev-cycle.md
  config.ts                   — requireQAPass config moves inline to orchestrator
  types/workflow-types.ts     — orphaned types, unused
  test/dev-cycle.test.ts      — orchestration tested manually via /dev-cycle
  test/config.test.ts         — trivial, remove
```

---

## Task 1: Create the orchestrator slash command

**Files:**
- Create: `.claude/commands/dev-cycle.md`

The orchestrator is the core of the new architecture. It defines the full pipeline as instructions that Claude follows when the user runs `/dev-cycle "task description"`.

- [ ] **Step 1: Create directories**

Run: `mkdir -p .claude/commands .claude/skills/dev-cycle`

- [ ] **Step 2: Write the orchestrator skill**

Create `.claude/commands/dev-cycle.md`:

```markdown
# Dev Cycle — Autonomous Development Pipeline

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

Spawn an Agent with the prompt from `.claude/skills/dev-cycle/requirements.md`.

Pass it: the user's task description ($ARGUMENTS) and the list of configured repos.

Collect: a structured requirements summary (goal, acceptance criteria, list of repos to check).

### Stage 2: Impact Analysis

Spawn an Agent with the prompt from `.claude/skills/dev-cycle/impact-analysis.md`.

Pass it: the requirements from Stage 1 and the repo paths.

Collect: which repos have actual changes, what files changed, what the changes do.

If no repos have changes, stop and tell the user: "No changes detected. Make your code changes first, then run /dev-cycle again."

### Stage 3: Validate Code State

Spawn an Agent with the prompt from `.claude/skills/dev-cycle/validate-code.md`.

Pass it: the list of changed repos and their paths.

Collect: per-repo branch name, diff summary, validation that each repo is on a feature branch.

If any repo is on main/master, stop and tell the user to create a feature branch.

### Stage 4: Unit Tests

Spawn an Agent with the prompt from `.claude/skills/dev-cycle/unit-tests.md`.

Pass it: the list of changed repos, their paths, and their test commands.

Collect: pass/fail per repo with test output.

**FAIL FAST:** If any repo's tests fail, stop immediately. Show the user the failure output and tell them to fix the tests before running /dev-cycle again. Do NOT proceed to QA.

### Stage 5: QA

Spawn an Agent with the prompt from `.claude/skills/dev-cycle/qa.md`.

Pass it: the project ID, the changed repos and files, the requirements goal.

Collect: QA report with passed/failed test cases.

If QA fails and the user hasn't set `requireQAPass: false` in their config, stop and report failures. The PRs should NOT be opened with failing QA unless the user explicitly opts in.

### Stage 6: Open PRs

Spawn an Agent with the prompt from `.claude/skills/dev-cycle/open-prs.md`.

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
```

- [ ] **Step 3: Verify the command is discoverable**

Run: `ls -la .claude/commands/dev-cycle.md`
Expected: file exists

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/dev-cycle.md .claude/skills/dev-cycle/
git commit -m "feat: add /dev-cycle orchestrator slash command"
```

---

## Task 2: Write the requirements skill

**Files:**
- Create: `.claude/skills/dev-cycle/requirements.md`

- [ ] **Step 1: Write the skill**

Create `.claude/skills/dev-cycle/requirements.md`:

```markdown
# Requirements Analysis Agent

You are analyzing a user's task description to extract structured requirements for an autonomous development cycle.

## Input

You receive:
- A user's task description (natural language)
- A list of configured repository names

## Your Job

1. **Read the task description carefully.** Understand what the user wants to build, fix, or change.
2. **Extract the goal** — one clear sentence describing the outcome.
3. **Extract acceptance criteria** — specific, verifiable conditions that must be true when the task is done. Each criterion should be independently testable. If the user's description is vague, infer reasonable criteria but flag them as inferred.
4. **Identify which repos are likely affected** — based on the task description and the repo names provided.

## Output

Report your findings as a structured summary:

**Goal:** (one sentence)

**Acceptance Criteria:**
- (criterion 1)
- (criterion 2)
- ...

**Affected Repos:** (comma-separated list)

**Notes:** (any ambiguities, assumptions, or questions — optional)

Do NOT ask the user questions. Make reasonable inferences and flag assumptions in Notes.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/dev-cycle/requirements.md
git commit -m "feat: add requirements analysis skill for dev cycle"
```

---

## Task 3: Write the impact analysis skill

**Files:**
- Create: `.claude/skills/dev-cycle/impact-analysis.md`

- [ ] **Step 1: Write the skill**

Create `.claude/skills/dev-cycle/impact-analysis.md`:

```markdown
# Impact Analysis Agent

You are analyzing git repositories to determine which ones have actual code changes that need to go through the dev cycle pipeline.

## Input

You receive:
- A list of repos with their local filesystem paths
- The requirements goal and affected repos from the requirements stage

## Your Job

For each repo path provided:

1. **Check the current branch:** Run `git branch --show-current` in the repo. If it returns empty (detached HEAD), report an error for that repo.
2. **Detect the default branch:** Run `git symbolic-ref refs/remotes/origin/HEAD --short` to find the default branch (e.g., `origin/main`). Strip the `origin/` prefix. If this fails, check if `main` or `master` exist locally via `git rev-parse --verify`.
3. **Verify it's a feature branch:** The current branch must NOT be the default branch. If it is, report an error.
4. **List changed files:** Run `git diff --name-only <default-branch>...HEAD` to find files changed on this branch relative to the default branch. If no merge base exists, fall back to `git diff --name-only HEAD`.
5. **Get the diff:** Run `git diff <default-branch>...HEAD` for the full diff.

## Output

Report per repo:

**Repo: (name)**
- Branch: (current branch name)
- Default branch: (detected default branch)
- Changed files: (list)
- Diff summary: (brief description of what changed)
- Status: OK | ERROR (with reason)

**Summary:** (which repos have changes, which don't, any errors)

If NO repos have any changes, clearly state: "No changes detected in any repo."
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/dev-cycle/impact-analysis.md
git commit -m "feat: add impact analysis skill for dev cycle"
```

---

## Task 4: Write the validate-code skill

**Files:**
- Create: `.claude/skills/dev-cycle/validate-code.md`

- [ ] **Step 1: Write the skill**

Create `.claude/skills/dev-cycle/validate-code.md`:

```markdown
# Code Validation Agent

You are validating that each repository's git state is ready for the dev cycle pipeline.

## Input

You receive:
- A list of repos with changes (from impact analysis), including their paths and branch names

## Your Job

For each repo:

1. **Verify the branch is a feature branch** (not main/master/the default branch). This should already be validated by impact analysis, but double-check.
2. **Check for uncommitted changes:** Run `git status --porcelain` in the repo. If there are uncommitted changes, warn the user — uncommitted changes won't be included in PRs.
3. **Get the branch diff:** Run `git diff <default-branch>...HEAD --stat` for a summary of changes.
4. **Verify commits exist on the branch:** Run `git log <default-branch>..HEAD --oneline` to confirm there are commits to push.

## Output

Per repo:

**Repo: (name)**
- Branch: (name)
- Commits on branch: (count and one-line summaries)
- Uncommitted changes: yes/no (with warning if yes)
- Diff stat: (file change summary)
- Status: READY | WARNING | ERROR

**Overall:** READY to proceed / BLOCKED (with reasons)
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/dev-cycle/validate-code.md
git commit -m "feat: add code validation skill for dev cycle"
```

---

## Task 5: Write the unit tests skill

**Files:**
- Create: `.claude/skills/dev-cycle/unit-tests.md`

- [ ] **Step 1: Write the skill**

Create `.claude/skills/dev-cycle/unit-tests.md`:

```markdown
# Unit Test Runner Agent

You are running unit tests for each repository that has changes in the dev cycle pipeline.

## Input

You receive:
- A list of repos with their paths and test commands (e.g., `pnpm test`)

## Your Job

For each repo:

1. **Run the test command** using Bash in the repo's directory. Use the provided test command (default: `pnpm test`).
2. **Capture the full output** — both stdout and stderr.
3. **Determine pass/fail** — exit code 0 means pass, anything else means fail.
4. **If tests fail**, extract the specific failing test names/descriptions from the output.

## Output

Per repo:

**Repo: (name)**
- Test command: (what was run)
- Result: PASS | FAIL
- Failed tests: (list, if any)
- Output: (relevant portion of test output — full output if failed, summary if passed)

**Overall:** ALL PASSED | FAILURES DETECTED

If any repo fails, clearly state which repos failed and include enough output for the user to diagnose the issue.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/dev-cycle/unit-tests.md
git commit -m "feat: add unit test runner skill for dev cycle"
```

---

## Task 6: Write the QA skill

**Files:**
- Create: `.claude/skills/dev-cycle/qa.md`

This is the most complex skill — it uses Muggle MCP tools to run QA against the changes.

- [ ] **Step 1: Write the skill**

Create `.claude/skills/dev-cycle/qa.md`:

```markdown
# QA Agent

You are running QA test cases against code changes using Muggle AI's testing infrastructure.

## Input

You receive:
- The Muggle project ID
- The list of changed repos, files, and a summary of changes
- The requirements goal

## Your Job

### Step 1: Check Authentication

Use the `muggle-remote-auth-status` MCP tool to verify you have valid credentials. If not authenticated, use `muggle-remote-auth-login` to start the device-code login flow and `muggle-remote-auth-poll` to wait for the user to complete login.

### Step 2: Get Test Cases

Use `muggle-remote-test-case-list` with the project ID to fetch all test cases for this project.

### Step 3: Filter Relevant Test Cases

Based on the changed files and the requirements goal, determine which test cases are relevant to the changes. Include:
- Test cases whose use cases directly relate to the changed functionality
- Test cases that cover areas potentially affected by the changes
- When in doubt, include the test case (it's better to test more than miss a regression)

### Step 4: Run Test Scripts

For each relevant test case that has test scripts:
1. Use `muggle-remote-test-script-list` to find test scripts for the test case
2. Use `muggle-remote-workflow-start-test-script-replay` to trigger a replay of the test script
3. Use `muggle-remote-wf-get-ts-replay-latest-run` to poll for results (check every 10 seconds, timeout after 5 minutes per test)

### Step 5: Collect Results

For each test case:
- Record whether it passed or failed
- If failed, capture the failure reason and any reproduction steps
- If a test script doesn't exist for a test case, note it as "no script available" (not a failure)

## Output

**QA Report:**

**Passed:** (count)
- (test case name): passed

**Failed:** (count)
- (test case name): (failure reason)

**Skipped:** (count, if any had no test scripts)
- (test case name): no test script available

**Overall:** ALL PASSED | FAILURES DETECTED | PARTIAL (some skipped)
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/dev-cycle/qa.md
git commit -m "feat: add QA skill using Muggle MCP tools for dev cycle"
```

---

## Task 7: Write the open-prs skill

**Files:**
- Create: `.claude/skills/dev-cycle/open-prs.md`

- [ ] **Step 1: Write the skill**

Create `.claude/skills/dev-cycle/open-prs.md`:

```markdown
# PR Creation Agent

You are creating pull requests for each repository that has changes after a successful dev cycle run.

## Input

You receive:
- Per-repo: repo name, path, branch name
- Requirements: goal, acceptance criteria
- QA report: passed/failed test cases

## Your Job

For each repo with changes:

1. **Push the branch** to origin: `git push -u origin <branch-name>` in the repo directory.
2. **Build the PR title:**
   - If QA has failures: `[QA FAILING] <goal>`
   - Otherwise: `<goal>`
   - Keep under 70 characters
3. **Build the PR body** with these sections:
   - `## Goal` — the requirements goal
   - `## Acceptance Criteria` — bulleted list (omit section if empty)
   - `## Changes` — summary of what changed in this repo
   - `## QA Results` — passed/failed counts, failure details if any
4. **Create the PR** using `gh pr create --title "..." --body "..." --head <branch>` in the repo directory.
5. **Capture the PR URL** from the output.

## Output

**PRs Created:**
- (repo name): (PR URL)

**Errors:** (any repos where PR creation failed, with the error message)
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/dev-cycle/open-prs.md
git commit -m "feat: add PR creation skill for dev cycle"
```

---

## Task 8: Clean up dead TypeScript code

**Files:**
- Delete: `packages/agents/` (entire directory)
- Delete: `apps/workflows-runner/` (entire directory)
- Delete: `packages/workflows/src/dev-cycle.ts`
- Delete: `packages/workflows/src/config.ts`
- Delete: `packages/workflows/src/types/workflow-types.ts`
- Delete: `packages/workflows/src/test/dev-cycle.test.ts`
- Delete: `packages/workflows/src/test/config.test.ts`
- Keep: `packages/workflows/src/contracts.ts`
- Keep: `packages/workflows/src/test/contracts.test.ts`
- Modify: `packages/workflows/src/index.ts` — only export contracts

**Important:** Ensure working tree is clean before this task (no unrelated unstaged changes). The deletions are targeted — no `git add -A`.

- [ ] **Step 1: Delete the entire packages/agents directory**

```bash
git rm -r packages/agents/
```

- [ ] **Step 2: Delete the entire apps/workflows-runner directory**

```bash
git rm -r apps/workflows-runner/
```

- [ ] **Step 3: Delete workflow orchestration and orphaned types (keep contracts)**

```bash
git rm packages/workflows/src/dev-cycle.ts \
      packages/workflows/src/config.ts \
      packages/workflows/src/types/workflow-types.ts \
      packages/workflows/src/test/dev-cycle.test.ts \
      packages/workflows/src/test/config.test.ts
```

- [ ] **Step 4: Update packages/workflows/src/index.ts**

Change to only export contracts:

```typescript
export * from './contracts.js';
```

- [ ] **Step 5: Remove @muggleai/agents from root package.json and pnpm-workspace.yaml if referenced**

Check if `@muggleai/agents` is referenced in the root `package.json` or turbo config. Remove any references to the deleted packages. Also remove `apps/workflows-runner` from any workspace config.

- [ ] **Step 6: Run pnpm install to update lockfile**

Run: `pnpm install`
Expected: lockfile updates to reflect removed packages

- [ ] **Step 7: Run typecheck to verify nothing is broken**

Run: `pnpm --filter @muggleai/workflows run typecheck`
Expected: passes (only contracts.ts remains, which has no imports)

- [ ] **Step 8: Run remaining tests**

Run: `pnpm --filter @muggleai/workflows test`
Expected: contracts.test.ts passes

- [ ] **Step 9: Commit**

```bash
git add packages/workflows/src/index.ts package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json
git commit -m "refactor: remove TypeScript agent classes and workflow runner

Replaced by Claude Code skills in .claude/commands/ and .claude/skills/.
Keep packages/workflows/contracts.ts as canonical type reference."
```

---

## Task 9: Update spec and commit final state

**Files:**
- Modify: `docs/superpowers/specs/2026-03-20-dev-cycle-design.md`

- [ ] **Step 1: Add architecture update note to the design spec**

Add at the top of the spec (after the header):

```markdown
> **Architecture Update (2026-03-22):** Implementation has moved from TypeScript agent classes to Claude Code skills. The orchestrator is at `.claude/commands/dev-cycle.md`, agent skills are at `.claude/skills/dev-cycle/*.md`. The `packages/agents` and `apps/workflows-runner` packages have been removed. `packages/workflows/contracts.ts` remains as the canonical type reference.
```

- [ ] **Step 2: Final verification**

Run: `pnpm test && pnpm run typecheck`
Expected: all remaining tests pass, no type errors

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-03-20-dev-cycle-design.md
git commit -m "docs: update design spec to reflect skill-based architecture"
```
