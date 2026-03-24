---
description: Unified AI development suite by Muggle AI. Dev pipeline (code → test → QA → PR) plus installation status, repair, and upgrade — all from one entry point.
---

# Muggle Do — AI Development Suite

Muggle Do is the single entry point for the Muggle AI development suite. It handles:

- **Dev tasks** — code → unit test → QA → PR, with iterative fix loops and full session state
- **Status** — health check for MCP server, Electron app, auth, and installed skills
- **Repair** — diagnose and fix broken local installation automatically
- **Upgrade** — update MCP server, Electron app, skills, and commands to the latest version

---

## Input

The user's input is: **$ARGUMENTS**

**Routing logic — check `$ARGUMENTS` first, before doing anything else:**

| `$ARGUMENTS` value | Action |
|--------------------|--------|
| Empty, `help`, `?`, `menu` | Show the [unified menu](#unified-menu) |
| `status` | Run [Status](#status) directly |
| `repair` | Run [Repair](#repair) directly |
| `upgrade` | Run [Upgrade](#upgrade) directly |
| Any other text | Treat as a dev task description — skip the menu, go straight to [Session Management](#session-management) |

---

## Repo Configuration

Repos are configured in `muggle-repos.json` in the working directory:

```json
[
  { "name": "frontend", "path": "/absolute/path/to/frontend", "testCommand": "pnpm test", "localUrl": "http://localhost:3000" },
  { "name": "backend",  "path": "/absolute/path/to/backend",  "testCommand": "pnpm test", "localUrl": "http://localhost:4000" }
]
```

The `localUrl` field is **required for QA**. It is the URL of the locally running dev server that the Electron test runner will target. If omitted, the QA stage will ask the user before proceeding.

Read this file at startup. If it does not exist, ask the user to provide repo details and create it before proceeding.

---

## Unified Menu

Show this when `$ARGUMENTS` is empty or a help keyword. Read `.muggle-do/sessions/*/state.md` to list existing sessions, then render:

```
Muggle Do — AI Development Suite

Sessions:
  [1] add-login-page   — CODING (iteration 2)   ← in progress
  [2] fix-payment      — DONE                   ← completed

  [3] Start a new dev task
  ──────────────────────────────────────────────
  [4] Status    check MCP, Electron app, auth, and skill versions
  [5] Repair    diagnose and fix broken local installation
  [6] Upgrade   update MCP server, Electron app, skills, and commands

Enter a number, or describe a new task to start immediately.
```

If no sessions exist, omit the Sessions block and start numbering at [1].

**Handling the user's response:**
- Number matching a session → resume or review that session
- Number matching "Start a new dev task" → proceed to Session Management (ask for task description if `$ARGUMENTS` is empty)
- Number matching **Status / Repair / Upgrade** → run the corresponding procedure below
- Free-text response → treat as a task description and go to Session Management

---

## Session Management

On invocation with a task description, check `.muggle-do/sessions/` for existing sessions.

### If sessions exist

Read each session's `state.md` to determine its status. If the user arrived here from the menu having already chosen "Start a new dev task", skip this prompt and create a new session directly.

Otherwise ask:
```
Existing sessions:
  [1] add-login-page        — CODING (iteration 2)    ← in progress
  [2] fix-payment-timeout   — DONE (2 iterations)     ← completed
  [3] Start new session

Which session? _
```

- **Resume active session** — continue from the current stage recorded in `state.md`
- **Review completed session** — read and display `result.md`
- **Start new session** — proceed with the task description

### If no sessions exist

Skip the prompt entirely. Go straight to creating a new session.

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

QA runs tests **locally** using the `test-feature-local` approach — cloud `muggle-remote-*` tools manage entities; local `muggle-local-*` tools execute the tests. This guarantees QA always runs, regardless of cloud replay service availability.

> **Note for user:** The local dev server must be running before QA starts. `muggle-do` will use the `localUrl` from `muggle-repos.json` for each repo.

#### Step 0: Resolve Local URL

For each repo being tested, read `localUrl` from `muggle-repos.json`. If it is missing, ask the user:
> "QA requires a running local server. What URL is the `<repo>` app running on? (e.g. `http://localhost:3000`)"
Do not skip QA — wait for the user to provide the URL.

#### Step 1: Check Authentication

Use `muggle-remote-auth-status` to verify credentials. If not authenticated, use `muggle-remote-auth-login` to start the device-code login flow and `muggle-remote-auth-poll` to wait for completion.

#### Step 2: Get Test Cases

Use `muggle-remote-test-case-list` with the project ID to fetch all test cases.

#### Step 3: Filter Relevant Test Cases

Based on the changed files and the requirements goal, determine which test cases are relevant. Include:
- Test cases whose use cases directly relate to the changed functionality
- Test cases that cover areas potentially affected by the changes
- When in doubt, include the test case (better to test more than miss a regression)

#### Step 4: Execute Tests Locally

For each relevant test case:

1. Call `muggle-remote-test-script-list` filtered by `testCaseId` to check for an existing script.

2. **If a script exists** (replay path):
   - Call `muggle-remote-test-script-get` with the `testScriptId` to fetch the full script object.
   - Call `muggle-local-execute-replay` with:
     - `testScript`: the full script object from the previous call
     - `localUrl`: the resolved local URL for this repo
     - `approveElectronAppLaunch`: `true` *(pipeline context — user starting `muggle-do` is implicit approval)*

3. **If no script exists** (generation path):
   - Call `muggle-remote-test-case-get` with the `testCaseId` to fetch the full test case object.
   - Call `muggle-local-execute-test-generation` with:
     - `testCase`: the full test case object from the previous call
     - `localUrl`: the resolved local URL for this repo
     - `approveElectronAppLaunch`: `true`

4. When execution completes, call `muggle-local-run-result-get` with the `runId` returned by the execute call.

5. **Retain per test case:** `testCaseId`, `testScriptId` (if present), `runId`, `status` (passed/failed), `artifactsDir` path.

#### Step 5: Collect Results

For each test case:
- Record pass or fail from the `muggle-local-run-result-get` response
- If failed, capture the error message and `artifactsDir` path for reproduction
- Every test case with a `testCaseId` must be executed — there is no "no script available" skip; generate a new script if none exists

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
   - `## QA Results` — full test case breakdown using the format below

**QA Results section format:**
```
## QA Results

**X passed / Y failed**

| Test Case | Status | Details |
|-----------|--------|---------|
| [Name](https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/scripts?modal=details&testCaseId={testCaseId}) | ✅ PASSED | — |
| [Name](https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/scripts?modal=details&testCaseId={testCaseId}) | ❌ FAILED | {error message} — artifacts: `{artifactsDir}` |
```

Rules:
- Link each test case name to its details page on www.muggle-ai.com using the URL pattern above.
- For failed tests, include the error message and the local `artifactsDir` path.
- Screenshots are in `{artifactsDir}/screenshots/` and can be viewed locally.
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

## Maintenance Procedures

### Status

Run a full health check of the local Muggle AI installation and report results.

**Steps:**

1. **Electron app** — read `~/.muggle-ai/electron-app/` to find the installed version directory. Read `.install-metadata.json` to get `executableChecksum`. Compute the current SHA-256 of the binary (`MuggleAI.app/Contents/MacOS/MuggleAI`). Compare. On macOS also run `spctl --assess --verbose <app-path>` to check code signing.

2. **MCP server** — call `muggle-local-check-status` to verify the MCP server is responsive and show auth state (authenticated, email, token expiry).

3. **Skills and commands** — check that `~/.claude/commands/muggle-do.md` and `~/.claude/skills/muggle/` exist. Read the last entry from `~/.muggle-ai/postinstall.log` to show installed versions and dates.

**Output format:**
```
Muggle AI — Installation Status

Electron app   ✅  v1.0.11  binary checksum OK, code signing OK
MCP server     ✅  responsive — authenticated as user@example.com (expires 2026-04-01)
Skills         ✅  3 skills installed, last updated 2026-03-23
Commands       ✅  muggle-do.md present

All systems operational.
```

Use ✅ for passing checks and ❌ for failures. After listing all checks, summarise with either "All systems operational" or "Issues found — run Repair to fix."

---

### Repair

Diagnose and fix broken components automatically.

**Steps:**

1. Run **Status** (above) to identify what is broken.
2. If everything passes, tell the user "Nothing to repair — installation looks healthy."
3. For each failing component, run the repair:
   - **Any component broken** → run `node <muggle-ai-works-path>/scripts/postinstall.mjs` via Bash. Discover `<muggle-ai-works-path>` from `~/.cursor/mcp.json` (the `args[0]` field under `mcpServers.muggle`) or by resolving the path of the `muggle` binary.
4. Run **Status** again to confirm all checks pass.
5. Report what was repaired and the new versions.

**Finding the install path:**
```bash
# From MCP config
cat ~/.cursor/mcp.json | grep -A3 '"muggle"'

# Or from the muggle binary
which muggle && readlink -f $(which muggle)
```

---

### Upgrade

Update the MCP server, Electron app, skills, and commands to the latest published version.

**Steps:**

1. Run **Status** to capture current versions.
2. Find the `muggle-ai-works` install path (same method as Repair).
3. Run the upgrade:
   ```bash
   cd <muggle-ai-works-path> && npm install
   ```
   This pulls the latest package version and triggers the postinstall script which updates the Electron app, skills, and commands.
4. Run **Status** again and diff the before/after versions to show what changed.
5. Report the upgrade summary.

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
