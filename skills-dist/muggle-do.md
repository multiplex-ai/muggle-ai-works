---
name: muggle-do
description: Quality-guranteed development workflow by Muggle AI. Takes a task through requirements, coding, testing, QA, and PR creation with iterative fix loops. Manages state in .muggle-do/sessions/ for auditability and crash recovery.
---

# Muggle Do — Autonomous Development Pipeline

Muggle Do is a session-based, iterative development pipeline. Given a task description, it autonomously:

1. Extracts requirements and acceptance criteria
2. Analyzes impact across configured repositories
3. Validates git state (branches, commits, working tree)
4. Writes or fixes implementation code
5. Runs unit tests
6. Runs QA test cases via Muggle AI infrastructure
7. Triages failures and loops back to fix them
8. Opens pull requests when done

Each run is a **session** with full state persistence in markdown files. Sessions survive crashes, support resume, and provide a complete audit trail.

---

## Input

The user's task description is: **$ARGUMENTS**

This is a natural-language description of what to build, fix, or change. If `$ARGUMENTS` is empty, ask the user to describe the task before proceeding.

---

## Repo Configuration

Repos are configured in `muggle-repos.json` in the working directory:

```json
[
  { "name": "frontend", "path": "/absolute/path/to/frontend", "testCommand": "pnpm test" },
  { "name": "backend", "path": "/absolute/path/to/backend", "testCommand": "pnpm test" }
]
```

Read this file at startup. If it does not exist, ask the user to provide repo details and create it before proceeding.

---

## Session Management

On invocation, check `.muggle-do/sessions/` for existing sessions.

### If sessions exist

Read each session's `state.md` to determine its status. Present the user with options:

```
Existing sessions:
  [1] add-login-page        — CODING (iteration 2)    ← in progress
  [2] fix-payment-timeout   — DONE (2 iterations)     ← completed
  [3] Start new session

Which session? _
```

- **Resume active session** — continue from the current stage recorded in `state.md`
- **Review completed session** — read and display `result.md`
- **Start new session** — proceed with `$ARGUMENTS` as the task description

### If no sessions exist

Skip the prompt entirely. Go straight to creating a new session with `$ARGUMENTS`.

### Session Naming

Generate a slug from the task description:
- Lowercase, hyphenated (replace spaces and non-alphanumeric chars with hyphens)
- Max 50 characters
- Remove leading/trailing hyphens and collapse consecutive hyphens
- On collision with an existing session directory, append a numeric suffix: `add-login-page-2`, `add-login-page-3`, etc.

Create the session directory structure:

```
.muggle-do/sessions/<slug>/
  state.md
  iterations/
```

Ensure `.muggle-do` is listed in `.gitignore`. If not, add it.

---

## State File Locations

Each session contains:

```
.muggle-do/sessions/<slug>/
  state.md              # Current state pointer — read this first on resume
  requirements.md       # Stable requirements (goal, criteria, repos)
  iterations/
    001.md              # Full record of iteration 1
    002.md              # Full record of iteration 2
    ...
  result.md             # Final outcome (written on completion)
```

### `state.md` Template

```markdown
# Muggle Do: <session-slug>

## Config
- **Task**: <user's task description>
- **Session**: <session-slug>
- **Started**: <ISO 8601 timestamp>
- **Repos**: <repo-name> (<path>), <repo-name> (<path>), ...
- **Max iterations**: 3

## Current
- **Iteration**: <number>
- **Stage**: <stage-name>
- **Previous failure**: <description or "none">
- **Jump target**: <stage or "none">
```

### `requirements.md` Template

```markdown
# Requirements

## Goal
<one clear sentence describing the outcome>

## Acceptance Criteria
1. <criterion 1>
2. <criterion 2>
3. ...

## Repos
| Repo | Path | Test Command |
|------|------|-------------|
| <name> | <path> | <command> |

## Notes
<any ambiguities, assumptions, or inferred criteria>
```

### `iterations/NNN.md` Template

```markdown
# Iteration <N>

## Impact Analysis
| Repo | Files | Changes |
|------|-------|---------|
| <name> | <file paths> | <description> |

## Validate Code
| Repo | Branch | Status |
|------|--------|--------|
| <name> | <branch> | <status description> |

## Coding
- <description of what was written or fixed>

## Unit Tests — <PASS|FAIL>
| Repo | Result | Details |
|------|--------|---------|
| <name> | <pass count> | <details> |

## QA — <PASS|FAIL>
| Test Case | Result | Details |
|-----------|--------|---------|
| <TC-ID: name> | <PASS|FAIL> | <details> |

## Triage
- **Failed stage**: <stage name>
- **Failure**: <what failed>
- **Analysis**: <root cause analysis>
- **Decision**: Jump to <STAGE>
- **Reasoning**: <why this jump target>
```

Only include sections for stages that actually ran in that iteration. If triage jumped to CODING, the iteration file starts at `## Coding`.

### `result.md` Template

```markdown
# Result

## Status: <DONE|QA_FAILING>
## Session: <session-slug>
## Completed: <ISO 8601 timestamp>
## Iterations: <total count>

## PRs
| Repo | PR | URL |
|------|-----|-----|
| <name> | <branch> | <URL> |

## QA Summary
- <pass count>/<total count> test cases passed (after <N> iterations)
- Iteration 1: <summary>
- Iteration 2: <summary>
```

---

## State Machine

### Stages

| Stage | Purpose | Runs every iteration? |
|-------|---------|----------------------|
| INIT | Create session, read config | Once |
| REQUIREMENTS | Extract goal + acceptance criteria from user task | Once (unless triage jumps back) |
| IMPACT_ANALYSIS | Detect changed files across repos | Yes |
| VALIDATE_CODE | Check branches, commits, clean working tree | Yes |
| CODING | Write new code (iteration 1) or fix code (subsequent iterations) | Yes |
| UNIT_TESTS | Run test commands per repo | Yes |
| QA | Run Muggle AI test cases | Yes |
| TRIAGE | Analyze failure, decide where to jump back | On failure only |
| OPEN_PRS | Push branches, create PRs | Once at end |
| DONE | Session complete | Terminal |

### State Transitions

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

---

## State Write Protocol

Update state files incrementally as you progress through stages:

1. **Before each stage**: Update `state.md` — set `Stage` to the current stage name.
2. **After each stage completes**: Append the stage results to the current iteration file (`iterations/NNN.md`).
3. **On triage**: Append the triage record to the current iteration file, then update `state.md` with the jump target stage and increment the iteration counter.
4. **On completion**: Write `result.md` and set `Stage` to `DONE` in `state.md`.

This means iteration files are built up incrementally (not written all at once), so a crash mid-stage leaves a partial but useful record that supports resume.

---

## Stage Instructions

Execute stages in order according to the state machine. When resuming a session, skip to the stage recorded in `state.md`.

---

### REQUIREMENTS

**When**: First stage of every new session. Also re-run if triage jumps back here.

**Update state.md**: Set Stage to `requirements`.

**Instructions:**

1. Read `muggle-repos.json` to get the list of configured repos with their names, paths, and test commands.
2. Read the user's task description (`$ARGUMENTS`).
3. Extract the **goal** — one clear sentence describing the outcome.
4. Extract **acceptance criteria** — specific, verifiable conditions that must be true when the task is done. Each criterion should be independently testable. If the task description is vague, infer reasonable criteria but flag them as inferred in Notes.
5. Identify which repos from `muggle-repos.json` are likely affected based on the task description.
6. Write `requirements.md` in the session directory using the template above. Include the full repo table from `muggle-repos.json`.

**Output**: The requirements are now written to `requirements.md`. Proceed to IMPACT_ANALYSIS.

Do NOT ask the user clarifying questions. Make reasonable inferences and note assumptions.

---

### IMPACT_ANALYSIS

**When**: After REQUIREMENTS, or when triage jumps back here.

**Update state.md**: Set Stage to `impact_analysis`.

**Instructions:**

For each repo listed in `requirements.md`:

1. **Check the current branch**: Run `git branch --show-current` in the repo. If it returns empty (detached HEAD), record an error for that repo.
2. **Detect the default branch**: Run `git symbolic-ref refs/remotes/origin/HEAD --short` to find the default branch (e.g., `origin/main`). Strip the `origin/` prefix. If this fails, check if `main` or `master` exist locally via `git rev-parse --verify`.
3. **Verify it is a feature branch**: The current branch must NOT be the default branch. If it is, create a feature branch from the task slug (e.g., `feat/<session-slug>`) and switch to it.
4. **List changed files**: Run `git diff --name-only <default-branch>...HEAD` to find files changed on this branch relative to the default branch. Also check `git status --porcelain` for uncommitted changes.
5. **Get the diff**: Run `git diff <default-branch>...HEAD` for the full diff. If this is the first iteration and there are no changes yet, that is expected — the CODING stage will create them.

**Record per repo:**
- Branch name
- Default branch
- Changed files (if any)
- Brief diff summary
- Status: OK or ERROR (with reason)

**Output**: Append the Impact Analysis section to the current iteration file. Proceed to VALIDATE_CODE.

If this is the first iteration and no changes exist yet, that is normal — proceed to VALIDATE_CODE and then CODING.

---

### VALIDATE_CODE

**When**: After IMPACT_ANALYSIS, or when triage jumps back here.

**Update state.md**: Set Stage to `validate_code`.

**Instructions:**

For each repo with changes (or all repos on first iteration):

1. **Verify the branch is a feature branch** (not main/master/the default branch). If on the default branch, create and checkout a feature branch: `feat/<session-slug>`.
2. **Check for uncommitted changes**: Run `git status --porcelain` in the repo. If there are uncommitted changes, note them — they should be committed during CODING.
3. **Get the branch diff**: Run `git diff <default-branch>...HEAD --stat` for a summary of changes.
4. **Verify commits exist on the branch** (if not first iteration): Run `git log <default-branch>..HEAD --oneline` to confirm there are commits.

**Record per repo:**
- Branch name
- Commit count and summaries
- Uncommitted changes: yes/no
- Diff stat
- Status: READY | WARNING | ERROR

**On failure** (e.g., merge conflicts, detached HEAD that cannot be resolved): Transition to TRIAGE.

**Output**: Append the Validate Code section to the current iteration file. Proceed to CODING.

---

### CODING

**When**: After VALIDATE_CODE, or when triage jumps back here (most common jump target).

**Update state.md**: Set Stage to `coding`.

**Instructions:**

#### First iteration (new feature):
- Read `requirements.md` for the goal and acceptance criteria
- Read the Impact Analysis section from the current iteration file for which files/repos to work with
- Write the implementation code across the identified repos
- For each repo, commit changes to the feature branch with descriptive commit messages
- Done when: code is committed and ready for testing

#### Subsequent iterations (fix):
- Read the Triage section from the **previous** iteration file to understand what failed and why
- Read the `Previous failure` and `Jump target` from `state.md`
- Edit the relevant code to address the specific failure
- Commit the fix with a message referencing what was fixed (e.g., `fix: mobile viewport for login submit button`)
- Done when: fix is committed and ready for re-testing

#### Multi-repo handling:
Work on each affected repo sequentially. Commit to each repo's feature branch before moving to the next.

**Output**: Append the Coding section to the current iteration file. Proceed to UNIT_TESTS.

---

### UNIT_TESTS

**When**: After CODING. Always runs before QA to catch regressions.

**Update state.md**: Set Stage to `unit_tests`.

**Instructions:**

For each repo listed in `requirements.md`:

1. **Run the test command** using Bash in the repo's directory. Use the `testCommand` from `muggle-repos.json` (default: `pnpm test`).
2. **Capture the full output** — both stdout and stderr.
3. **Determine pass/fail** — exit code 0 means pass, anything else means fail.
4. **If tests fail**, extract the specific failing test names and descriptions from the output.

**Record per repo:**
- Test command run
- Result: PASS or FAIL
- Failed tests (list, if any)
- Relevant output (full if failed, summary if passed)

**On pass (all repos)**: Append Unit Tests section to iteration file. Proceed to QA.

**On failure**: Append Unit Tests section to iteration file. Transition to TRIAGE.

---

### QA

**When**: After UNIT_TESTS pass.

**Update state.md**: Set Stage to `qa`.

**Instructions:**

#### Step 1: Check Authentication

Use the `muggle-remote-auth-status` MCP tool to verify valid credentials. If not authenticated, use `muggle-remote-auth-login` to start the device-code login flow and `muggle-remote-auth-poll` to wait for the user to complete login.

#### Step 2: Get Test Cases

Use `muggle-remote-test-case-list` with the project ID to fetch all test cases for this project.

#### Step 3: Filter Relevant Test Cases

Based on the changed files and the requirements goal, determine which test cases are relevant. Include:
- Test cases whose use cases directly relate to the changed functionality
- Test cases that cover areas potentially affected by the changes
- When in doubt, include the test case (better to test more than miss a regression)

#### Step 4: Run Test Scripts

For each relevant test case that has test scripts:
1. Use `muggle-remote-test-script-list` to find test scripts for the test case
2. Use `muggle-remote-workflow-start-test-script-replay` to trigger a replay
3. Use `muggle-remote-wf-get-ts-replay-latest-run` to poll for results (check every 10 seconds, timeout after 5 minutes per test)

#### Step 5: Collect Results

For each test case:
- Record pass or fail
- If failed, capture the failure reason and reproduction steps
- If no test script exists for a test case, note it as "no script available" (not a failure)

**On pass (all test cases)**: Append QA section to iteration file. Proceed to OPEN_PRS.

**On failure**: Append QA section to iteration file. Transition to TRIAGE.

---

### TRIAGE

**When**: After any stage fails (VALIDATE_CODE, UNIT_TESTS, or QA).

**Update state.md**: Set Stage to `triage`.

**Instructions:**

1. **Identify what failed**: Read the failed stage's output from the current iteration file.

2. **Analyze the failure**: Determine the root cause. Is it a requirements issue, a scoping issue, a git issue, or a code bug?

3. **Classify using these heuristics** (in order):

   | # | Question | If yes, jump to | Signal |
   |---|----------|-----------------|--------|
   | 1 | Does the failure indicate the goal or acceptance criteria are wrong or incomplete? | REQUIREMENTS | QA reveals a user flow that contradicts the stated goal, or acceptance criteria are missing a scenario |
   | 2 | Does the fix require changing files not currently in scope? | IMPACT_ANALYSIS | The fix touches repos or files not identified in the impact analysis |
   | 3 | Are there branch or commit issues? | VALIDATE_CODE | Uncommitted changes, wrong branch, merge conflicts |
   | 4 | Is it a code-level bug (logic, styling, API)? | CODING | Test output points to specific behavior the code should handle differently |

   **When uncertain, default to CODING** — it is the lowest-risk jump target since unit tests will catch regressions before re-running QA.

4. **Record the triage decision** in the current iteration file using the Triage section template.

5. **Update state.md**:
   - Set `Stage` to the jump target
   - Set `Previous failure` to a brief description of what failed
   - Set `Jump target` to the target stage name
   - If jumping to REQUIREMENTS: increment `Iteration` (this restarts the pipeline scope)
   - If jumping to IMPACT_ANALYSIS, VALIDATE_CODE, or CODING: increment `Iteration`

6. **Create a new iteration file** (`iterations/NNN.md`) for the next iteration.

7. **Continue execution** at the jump target stage.

Note: When triage jumps to CODING, the subsequent flow always passes through UNIT_TESTS before re-running QA (code changes could break tests).

---

### OPEN_PRS

**When**: After QA passes, OR after max iterations reached (with QA_FAILING tag).

**Update state.md**: Set Stage to `open_prs`.

**Instructions:**

For each repo with changes:

1. **Push the branch** to origin: `git push -u origin <branch-name>` in the repo directory.
2. **Build the PR title:**
   - If QA has failures (max iterations reached without passing): `[QA FAILING] <goal>`
   - Otherwise: `<goal>`
   - Keep under 70 characters
3. **Build the PR body** with these sections:
   - `## Goal` — the requirements goal
   - `## Acceptance Criteria` — bulleted list from `requirements.md`
   - `## Changes` — summary of what changed in this repo
   - `## QA Results` — passed/failed counts, failure details if any
4. **Create the PR** using `gh pr create --title "..." --body "..." --head <branch>` in the repo directory.
5. **Capture the PR URL** from the output.

**Output**: Record all PR URLs. Proceed to DONE.

---

### DONE

**When**: After OPEN_PRS completes.

**Instructions:**

1. Write `result.md` in the session directory using the template above.
2. Update `state.md`: Set Stage to `done`.
3. Present the final results to the user:
   - List of PRs opened (with URLs)
   - QA summary (passed/failed counts, iteration history)
   - Any warnings or issues encountered
   - Total iterations used

---

## Guardrails

### Max fix attempts per stage

If the same stage fails **3 consecutive times** (e.g., 3 failed unit test runs in a row), stop and escalate to the user:

```
ESCALATION: Unit tests have failed 3 consecutive times.

Latest failure:
  <failure details>

Previous attempts:
  Iteration 1: <what was tried>
  Iteration 2: <what was tried>
  Iteration 3: <what was tried>

Please review the failures and provide guidance on how to proceed.
```

The per-stage failure counter resets when the stage passes.

### Max total iterations

If the pipeline has completed **3 full iterations** (cycles through CODING -> UNIT_TESTS -> QA) and QA still fails, stop iterating and proceed directly to OPEN_PRS with the `[QA FAILING]` prefix on PR titles.

### Triage to REQUIREMENTS

A triage decision that jumps back to REQUIREMENTS counts as starting a new iteration, since it restarts the pipeline scope. This counts against the max total iterations limit.

### Unresolvable failures

If you cannot determine a fix or the failure is outside your capability (e.g., infrastructure issue, missing credentials, external service down), pause and escalate to the user with a clear description of:
- What stage failed
- What the failure is
- What you have already tried
- What you need from the user to continue

---

## Error Handling

- If a stage encounters an unexpected error (not a test failure, but an infrastructure/tooling error), report it clearly and pause for user input.
- Always show which stage failed and why.
- Never silently skip a stage or continue past an error without recording it.
- If `muggle-repos.json` is missing or malformed, stop and ask the user to fix it before proceeding.
- If a repo path does not exist on disk, report the error and exclude that repo (continue with remaining repos if any).
