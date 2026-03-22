# Skill Distribution & Muggle-Do State Machine Design

## Problem

Customers install `@muggleai/works` via `npm install -g @muggleai/works` and get MCP tools + CLI, but **not** the skills that teach their AI assistant how to orchestrate those tools into workflows. Skills like `muggle-do`, `test-feature-local`, and `publish-test-to-cloud` only exist inside the repo.

Additionally, `muggle-do` is a complex 6+ stage pipeline currently implemented as a stateless Claude Code skill. It has no state persistence, no iteration tracking, and no ability to loop back when QA or tests fail.

## Goals

1. Customers get all skills automatically with `npm install -g @muggleai/works`
2. `muggle-do` supports iterative loops (QA fails -> fix -> retest -> re-QA)
3. `muggle-do` manages state in markdown files for auditability
4. Skills update cleanly on upgrade with modification detection

## Target Customer

Developer using Claude Code as their AI coding assistant. The AI is the orchestrator — it reads skills and calls MCP tools.

## Key Changes from Current Implementation

The current `muggle-do` (in `.claude/commands/muggle-do.md`) is a **stateless, linear pipeline** that assumes code is already written and fails fast on any error. This design replaces it with:

1. **CODING stage** — muggle-do becomes an autonomous coding agent, not just a "validate and ship" tool. It writes and fixes code, not just tests existing changes.
2. **TRIAGE stage** — instead of fail-fast, failures are analyzed and the pipeline loops back to the appropriate stage.
3. **State persistence** — markdown files in `.muggle-do/` track progress across iterations.
4. **Iteration support** — QA failures trigger fix-and-retry loops with full audit trails.

The current `.claude/commands/muggle-do.md` and `.claude/skills/muggle-do/*.md` (6 stage files) are replaced by a single consolidated `skills-dist/muggle-do.md` that embeds all stage instructions and state machine logic. The old files remain in the repo for reference but are superseded by the distributed version.

---

## Design

### 1. Skill Distribution

#### What Gets Distributed

Skills are bundled in the npm package under `skills-dist/` and copied to `~/.claude/skills/muggle/` during postinstall. Claude Code discovers user-level skills from `~/.claude/skills/` — these are available globally across all projects.

**In the npm package:**

```
skills-dist/
  muggle-do.md                  # Stateful orchestrator
  test-feature-local.md         # Stateless skill
  publish-test-to-cloud.md      # Stateless skill
```

**Installed to customer's machine:**

```
~/.claude/skills/muggle/
  muggle-do.md
  test-feature-local.md
  publish-test-to-cloud.md
```

**`package.json` change:**

```json
"files": [
  "dist",
  "bin/muggle.js",
  "scripts/postinstall.mjs",
  "skills-dist"
]
```

#### Postinstall Skill Installation Flow

```
For each skill file in skills-dist/:

    File doesn't exist at target?
        -> Copy it, store checksum

    File exists, checksum matches stored?
        -> Overwrite silently, update checksum

    File exists, checksum DOESN'T match stored?
        -> User modified it. Prompt:
           (A) Overwrite — replace with new version
           (B) Overwrite with backup — save to ~/.muggle-ai/skills-backup/{timestamp}/

    No TTY available (CI)?
        -> Default to (B) backup + overwrite
```

#### Postinstall Prompting Mechanism

The current `postinstall.mjs` uses only `console.log`/`console.error` with no interactive prompting. To add prompting:

- Use Node.js `readline` with `process.stdin`/`process.stdout` to detect TTY and prompt
- Check `process.stdin.isTTY` before attempting to prompt
- When no TTY is available (CI, piped installs, some package managers), default to option (B) — backup + overwrite — as the safer choice
- Keep prompting simple: single-character input (A/B), with a timeout (default to B after 30 seconds of no input)

#### Checksum Tracking

Checksums stored in `~/.muggle-ai/skills-checksums.json`:

```json
{
  "schemaVersion": 1,
  "packageVersion": "2.0.0",
  "files": {
    "muggle-do.md": "sha256:abc123...",
    "test-feature-local.md": "sha256:def456...",
    "publish-test-to-cloud.md": "sha256:ghi789..."
  }
}
```

- `schemaVersion`: format version of this file (for future migrations)
- `packageVersion`: the `@muggleai/works` version that wrote these checksums (informational)

---

### 2. Muggle-Do State Machine

#### Stages

| Stage | Purpose | Runs every iteration? |
|-------|---------|----------------------|
| REQUIREMENTS | Extract goal + acceptance criteria from user task | Once (unless triage jumps back) |
| IMPACT_ANALYSIS | Detect changed files across repos | Yes |
| VALIDATE_CODE | Check branches, commits, clean working tree | Yes |
| CODING | Write new code (iteration 1) or fix code (subsequent iterations, directed by triage) | Yes |
| UNIT_TESTS | Run test commands per repo | Yes |
| QA | Run Muggle AI test cases | Yes |
| TRIAGE | Analyze failure, decide where to jump back | On failure only |
| OPEN_PRS | Push branches, create PRs | Once at end |

#### State Transitions

```
                    INIT
                      |
                      v
                 REQUIREMENTS  <--- triage: "flow can't be accomplished"
                      |
        +-------------+---- Iteration --------+
        |             v                        |
        |      IMPACT_ANALYSIS  <--- triage: "need different files"
        |             |                        |
        |             v                        |
        |      VALIDATE_CODE   <--- triage: "branch/commit issues"
        |             |                        |
        |             v                        |
        |         CODING       <--- triage: "styling fix", "logic bug"
        |             |                        |
        |             v                        |
        |        UNIT_TESTS                    |
        |             |                        |
        |             v                        |
        |            QA                        |
        |             |                        |
        |      fail   |   pass                 |
        |      v      |                        |
        |   TRIAGE    |                        |
        |      |      |                        |
        |      +------+--- (jumps back) -------+
        |             |
        +-------------+
                      v
                  OPEN_PRS
                      |
                      v
                    DONE
```

#### Triage Behavior

After any failure, TRIAGE analyzes the failure and decides which stage to jump back to:

| Failure Type | Example | Jump To |
|-------------|---------|---------|
| Requirements wrong | "Login flow requires SSO but criteria only mention email/password" | REQUIREMENTS |
| Wrong files scoped | "Need to also change the auth middleware" | IMPACT_ANALYSIS |
| Branch/commit issues | "Changes not committed" | VALIDATE_CODE |
| Code bug | "Button color wrong", "API returns 500" | CODING |
| Test gap | "Tests pass but don't cover failing scenario" | CODING |

When QA fix loops back, it always passes through UNIT_TESTS before re-running QA (code changes could break tests).

#### Triage Decision Heuristics

Claude uses these heuristics to classify failures and decide where to jump:

1. **Does the failure indicate the goal or acceptance criteria are wrong or incomplete?** → REQUIREMENTS. Signal: QA reveals a user flow that contradicts the stated goal, or acceptance criteria are missing a scenario that the tests expect.
2. **Does the fix require changing files not currently in scope?** → IMPACT_ANALYSIS. Signal: the fix touches repos or files not identified in the impact analysis.
3. **Are there branch or commit issues?** → VALIDATE_CODE. Signal: uncommitted changes, wrong branch, merge conflicts.
4. **Is it a code-level bug (logic, styling, API)?** → CODING. This is the most common case. Signal: the test output points to specific behavior that the code should handle differently.

When uncertain, default to CODING — it's the lowest-risk jump target since unit tests will catch regressions before re-running QA.

#### CODING Stage Specification

The CODING stage is where Claude writes or modifies code. Its behavior depends on context:

**First iteration (new feature):**
- Input: requirements (goal + acceptance criteria) + impact analysis (which files/repos)
- Claude writes the implementation code across the identified repos
- Commits changes to the feature branch with descriptive commit messages
- Done when: code is committed and ready for testing

**Subsequent iterations (fix):**
- Input: triage decision (what failed + why + what to fix)
- Claude reads the failure details from the current iteration file
- Edits the relevant code to address the specific failure
- Commits the fix with a message referencing what was fixed
- Done when: fix is committed and ready for re-testing

**Multi-repo handling:** Claude works on each affected repo sequentially, committing to each repo's feature branch.

#### Guardrails

- **Max fix attempts per stage**: 3 consecutive failures at the same stage (e.g., 3 failed unit test runs) before escalating to user. Counter resets when the stage passes.
- **Max total iterations**: 3 full cycles through CODING → UNIT_TESTS → QA. If QA still fails after 3 iterations, proceed to OPEN_PRS with `[QA FAILING]` tag.
- **Triage jumping to REQUIREMENTS** counts as a new iteration since it restarts the pipeline scope.
- If Claude cannot resolve a fix: pause and escalate to user

---

### 3. State File Structure

Each `muggle-do` run creates a `.muggle-do/` directory in the working directory where Claude is invoked (typically the project root). For multi-repo setups, this is the directory containing `muggle-repos.json`, not individual repo roots.

The `.muggle-do/` directory should be added to `.gitignore` — it is ephemeral working state, not something to commit. The `result.md` file serves as the audit summary if needed after the run.

```
.muggle-do/
  state.md              # Current state pointer
  requirements.md       # Stable requirements
  iterations/
    001.md              # Full record of iteration 1
    002.md              # Full record of iteration 2
    ...
  result.md             # Final outcome
```

#### `state.md` — Entry Point

Claude reads this first to know where it is. On startup, the muggle-do skill checks for an existing `.muggle-do/state.md`:
- **If it exists and stage is not DONE**: resume from the current stage (enables recovery from crashed sessions)
- **If it exists and stage is DONE**: ask the user whether to start fresh or review results
- **If it doesn't exist**: create `.muggle-do/` and start from INIT

```markdown
# Muggle Do

## Config
- **Task**: Add login page with email/password authentication
- **Started**: 2026-03-22T10:30:00Z
- **Repos**: frontend (/path/to/frontend), backend (/path/to/backend)
- **Max iterations**: 3

## Current
- **Iteration**: 2
- **Stage**: coding
- **Previous failure**: QA — TC-456 mobile viewport issue
- **Jump target**: coding (from triage)
```

#### `requirements.md` — Stable Across Iterations

```markdown
# Requirements

## Goal
Add login page with email/password authentication

## Acceptance Criteria
1. Login form with email and password fields
2. Form validation with error messages
3. Redirect to dashboard on success
4. Responsive on mobile viewports

## Repos
| Repo | Path | Test Command |
|------|------|-------------|
| frontend | /path/to/frontend | pnpm test |
| backend | /path/to/backend | pnpm test |
```

#### `iterations/001.md` — Full Audit Record

```markdown
# Iteration 1

## Impact Analysis
| Repo | Files | Changes |
|------|-------|---------|
| frontend | src/pages/login.tsx | Added login page component |
| frontend | src/components/LoginForm.tsx | Added form component |
| backend | src/routes/auth.ts | Added /auth/login endpoint |

## Validate Code
| Repo | Branch | Status |
|------|--------|--------|
| frontend | feat/add-login | 2 commits ahead, clean |
| backend | feat/add-login | 1 commit ahead, clean |

## Coding
- First pass: implemented login page and auth endpoint

## Unit Tests — PASS
| Repo | Result | Details |
|------|--------|---------|
| frontend | 42/42 passed | — |
| backend | 18/18 passed | — |

## QA — FAILED
| Test Case | Result | Details |
|-----------|--------|---------|
| TC-123: Login form renders | PASS | — |
| TC-456: Mobile responsiveness | FAIL | Submit button not visible < 375px |
| TC-789: Error handling | PASS | — |

## Triage
- **Failed stage**: QA
- **Failure**: TC-456 — submit button not visible on mobile
- **Analysis**: CSS issue, button hidden below fold on small screens
- **Decision**: Jump to CODING
- **Reasoning**: Requirements correct, just a CSS bug
```

#### `iterations/002.md` — Fix Iteration

Iteration files only contain stages that ran in that iteration. If triage jumped to CODING, earlier stages are skipped.

```markdown
# Iteration 2

## Coding
- Fixed mobile viewport CSS for LoginForm submit button
- Commit: abc1234 "fix: mobile viewport for login submit button"

## Unit Tests — PASS
| Repo | Result | Details |
|------|--------|---------|
| frontend | 42/42 passed | — |
| backend | 18/18 passed | — |

## QA — PASS
| Test Case | Result | Details |
|-----------|--------|---------|
| TC-123: Login form renders | PASS | — |
| TC-456: Mobile responsiveness | PASS | — |
| TC-789: Error handling | PASS | — |
```

#### `result.md` — Final Outcome

```markdown
# Result

## Status: DONE
## Completed: 2026-03-22T11:15:00Z
## Iterations: 2

## PRs
| Repo | PR | URL |
|------|-----|-----|
| frontend | feat/add-login | https://github.com/org/frontend/pull/42 |
| backend | feat/add-login | https://github.com/org/backend/pull/17 |

## QA Summary
- 3/3 test cases passed (after 2 iterations)
- Iteration 1: 1 failure (TC-456 mobile viewport)
- Iteration 2: all passed
```

#### State Write Protocol

Claude updates state files incrementally as it progresses:

1. **Before each stage**: update `state.md` with the current stage name
2. **After each stage completes**: append the stage results to the current iteration file (`iterations/NNN.md`)
3. **On triage**: append the triage record to the current iteration file, then update `state.md` with the jump target and increment the iteration counter
4. **On completion**: write `result.md` and update `state.md` stage to DONE

This means iteration files are built up incrementally (not written all at once), so a crash mid-iteration leaves a partial but useful record.

#### Repo Configuration

Repos are configured via `muggle-repos.json` in the working directory (same mechanism as the current muggle-do implementation):

```json
[
  { "name": "frontend", "path": "/absolute/path/to/frontend", "testCommand": "pnpm test" },
  { "name": "backend", "path": "/absolute/path/to/backend", "testCommand": "pnpm test" }
]
```

The REQUIREMENTS stage reads this file and copies the repo list into `requirements.md` for reference. If `muggle-repos.json` doesn't exist, muggle-do prompts the user to create it.

---

### 4. What Gets Modified

| File | Change |
|------|--------|
| `package.json` | Add `skills-dist` to `files` field |
| `scripts/postinstall.mjs` | Add skill installation with checksum tracking and user prompting |
| `skills-dist/muggle-do.md` | New: consolidated orchestrator replacing `.claude/commands/muggle-do.md` + `.claude/skills/muggle-do/*.md` (6 files) |
| `skills-dist/test-feature-local.md` | Adapted from `skills/local/test-feature-local/SKILL.md` |
| `skills-dist/publish-test-to-cloud.md` | Adapted from `skills/local/publish-test-to-cloud/SKILL.md` |

### 5. What Is NOT Changed

- Existing MCP tools — no new tools needed. muggle-do uses existing primitives.
- CLI commands — no new commands.
- `packages/workflows/src/contracts.ts` — existing contracts partially align with the state file structure (e.g., `TaskSpec` maps to requirements, `QAReport` maps to QA results) but are not directly used at runtime. State is markdown, not typed objects. New concepts like TRIAGE and CODING have no corresponding contract types.
- Current `skills/local/` — kept as dev-only reference versions. `skills-dist/` is the distributable copy.
- Current `.claude/commands/muggle-do.md` and `.claude/skills/muggle-do/*.md` — superseded by `skills-dist/muggle-do.md`. Kept in repo for reference during transition, can be removed after the new version is validated.
