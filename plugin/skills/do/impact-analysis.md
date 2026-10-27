# Impact Analysis Agent (Stage 4)

You are analyzing git repositories to determine which ones have actual code changes that need to go through the dev cycle pipeline, and which use cases and test cases the E2E acceptance stage must run for them.

## Turn preamble

Start the turn with:

```
**Stage 4 — Impact analysis** — diffing each affected repo against its default branch and scoping the E2E cases.
```

## Input

You receive:
- A list of repos with their local filesystem paths
- The requirements goal, acceptance criteria, and affected repos from the requirements stage (`requirements.md`); in an address-reviews cycle, also the review-derived change items `build.md` was given
- Pre-flight state, including `worktreePath` when a worktree was selected (see [`../_shared/use-worktrees.md`](../_shared/use-worktrees.md)), and the `## Pre-flight answers` block's `Validation` and `projectId`

## Your Job

For each repo path provided:

1. **Resolve analysis path with worktree awareness:**
   - If `worktreePath` exists for this repo/session, run all git commands from `worktreePath`.
   - Otherwise run from the repo path.
   - Never mix command cwd across base repo + worktree in one analysis pass.
2. **Detect worktree context:** Run `git worktree list --porcelain` and determine whether the analysis path is:
   - a linked worktree checkout, or
   - the primary checkout.
   Record this in output as `checkoutType`.
3. **Check the current branch:** Run `git branch --show-current` in the resolved analysis path. If it returns empty (detached HEAD), report an error for that repo.
4. **Detect the default branch:** Run `git symbolic-ref refs/remotes/origin/HEAD --short` to find the default branch (e.g., `origin/main`). Strip the `origin/` prefix. If this fails, check if `main` or `master` exist locally via `git rev-parse --verify`.
5. **Verify it's a feature branch:** The current branch must NOT be the default branch. If it is, report an error.
6. **List changed files:** Run `git diff --name-only <default-branch>...HEAD` to find files changed on this branch relative to the default branch. If no merge base exists, fall back to `git diff --name-only HEAD`.
7. **Get the diff:** Run `git diff <default-branch>...HEAD` for the full diff.
8. **Classify changed paths** to drive downstream test routing — emit `pathClassification` (see "Output state — pathClassification" below).
9. **Scope the E2E cases** — map the diff and the acceptance criteria to the impacted existing use cases and test cases and the new ones to add; emit `e2eScope` (see "Output state — e2eScope" below).

## Output

Report per repo:

**Repo: (name)**
- Analysis path: (resolved path used for git commands)
- Checkout type: `worktree` | `primary`
- Branch: (current branch name)
- Default branch: (detected default branch)
- Changed files: (list)
- Diff summary: (brief description of what changed)
- Status: OK | ERROR (with reason)

**Summary:** (which repos have changes, which don't, any errors)

If NO repos have any changes, clearly state: "No changes detected in any repo."

## Output state — pathClassification

Per repo, emit one additional field that the E2E acceptance stage (`do/e2e-acceptance.md` Steps 1.5 and 1.7) consumes to pick routing + project mapping without hardcoding product paths:

```
pathClassification: <surface-a | surface-b | mixed | none>
```

Definitions:
- **`surface-a`** — all changed files match the repo's configured pattern set A.
- **`surface-b`** — all changed files match the repo's configured pattern set B.
- **`mixed`** — at least one file matches pattern set A and at least one file matches pattern set B.
- **`none`** — empty diff (placeholder branch — see standardized output below).

Pattern sets must be treated as repo-configured routing buckets (for example, marketing-vs-app areas), not global hardcoded paths in this stage.

### Standardized "no changes" output (placeholder branch)

If `git diff <default>...HEAD --stat` is empty for a repo, emit:

```
pathClassification: none
filesChanged: []
recommendation: SKIPPED — placeholder branch, no code under test
```

`do/e2e-acceptance.md` Step 1.5 reads this and exits the stage cleanly with a SKIPPED verdict — do not silently run tests against master.

## Output state — cycleSize (watcher-dispatched cycles)

When the caller passes `pre_cycle_sha` ([`cycle-size.md`](cycle-size.md)), also list the paths this cycle changed, committed or not: `git diff --name-only --no-renames <pre_cycle_sha>` for tracked files, plus `git ls-files --others --exclude-standard` for new ones. Emit:

```
cycleFiles: [<path>, ...]
cycleSize: <minor | full>
```

`minor` only when every path in `cycleFiles` is in the `NO_APP_LOGIC_CHANGE` path set defined in [`e2e-acceptance.md`](e2e-acceptance.md); otherwise `full`. The rest of this stage still runs against the default branch, so a full cycle's E2E routes from `pathClassification` as in a forward run.

A rebase is not sized here: the tree diff from `rebase_sha` carries everything the base brought in. Its size comes from its `NO_APP_LOGIC_CHANGE` declaration after the push, which compares the PR's own patch per [`cycle-size.md`](cycle-size.md) Rebase size; a rejected declaration is the `full` that scopes E2E.

## Output state — e2eScope

The case selection [`e2e-acceptance.md`](e2e-acceptance.md) runs. Stage 6 executes this scope rather than choosing its own, so the choice is made here, where the diff and the acceptance criteria are both in hand.

Scope only when this cycle runs E2E: `Validation` is `local-e2e`, `pathClassification` is not `none`, and in a watcher cycle `cycleSize` is `full`. Otherwise emit `e2eScope: not-scoped — <the condition that failed>`.

The criteria are the acceptance criteria in the session's `requirements.md`, plus each review-derived change item that alters behavior in an address-reviews cycle. A session with no `requirements.md` (an adopted PR) scopes from the diff alone and writes `criteria: []`.

### Procedure

1. **List the project's cases.** `muggle-remote-use-case-list` for the project the classification routes to (single-project repos: `projectId` from `state.md`), then `muggle-remote-test-case-list-by-use-case` for every use case, all in one message. `e2eScope` holds one entry per project, so `mixed` scopes each classification's project as its own entry.
2. **Impacted use cases.** A use case is impacted when its flow passes through a page, route, component, endpoint, or data flow the diff changes, or when an acceptance criterion falls inside it.
3. **Impacted test cases.** Under each impacted use case, a test case is impacted when it exercises a changed surface or verifies a behavior a criterion touches. When in doubt, include it: an extra replay costs minutes, a missed regression ships.
4. **Retired cases.** A test case the change makes wrong fails by design, so it is retired, never impacted. Replaying it would send Stage 7.5 to repair the product back to the old behavior.
   - **Replaced** — the change alters its expected outcome (a renamed label, a removed step, a new validation rule). Plan a new test case for the new expectation and name it in `replacedBy`.
   - **Removed** — the change removes the feature it verifies. `replacedBy: none`.

   A use case is retired only when the change removes its whole flow **and** every test case under it is retired: deleting a use case cascades to all its test cases and scripts, so one surviving test case keeps the use case. Retired cases are deleted after the PR merges ([`cleanup.md`](cleanup.md)), never during the cycle — an unmerged change must leave the project's suite intact for the default branch.
5. **Map every criterion.** Each criterion carries `coveredBy` (impacted or new test cases that verify it) or `unobservable` (why no browser can observe it: a log line, a unit-test requirement, a config value). A criterion with neither is a scoping failure.
6. **Plan the new cases.** Each uncovered criterion gets a new test case under the impacted use case its behavior belongs to, or under a new use case when none fits. A test case instruction names one atomic behavior to verify, with no signup, login, navigation, or seed-data steps, per [`../_shared/test-case-design.md`](../_shared/test-case-design.md); prerequisites come from the test-plan graph at run time ([`../_shared/test-case-chain-readiness.md`](../_shared/test-case-chain-readiness.md)).

This stage plans new cases and creates nothing. Stage 6 creates them, so a cycle that never reaches E2E leaves no cases behind in the project.

### Shape

```
e2eScope:
  - projectId: <id>
    impactedUseCases:
      - useCaseId: <id>
        title: <title>
        reason: <changed path or criterion that puts it in scope>
    impactedTestCases:
      - testCaseId: <id>
        useCaseId: <id>
        title: <title>
        reason: <changed path or criterion>
    retiredUseCases:
      - useCaseId: <id>
        title: <title>
        reason: <the flow the change removes>
    retiredTestCases:
      - testCaseId: <id>
        title: <title>
        reason: <the expectation the change alters, or the feature it removes>
        replacedBy: <new test case key | none>
    newUseCases:
      - key: NUC1
        instruction: <plain-English description of the use case>
    newTestCases:
      - key: NTC1
        useCase: <useCaseId | new use case key>
        instruction: <one atomic behavior to verify>
    criteria:
      - criterion: <acceptance criterion>
        coveredBy: [<testCaseId | new test case key>, ...]
      - criterion: <acceptance criterion>
        unobservable: <why no browser can observe it>
```

An empty list is written empty, never omitted; an absent list reads as "not scoped". Record the scope in this stage's marker in `iterations/<NNN>.md`, so Stage 6, a Stage 7.5 re-run, and a resumed session read the same one.

In a wave each member repo emits its own `e2eScope`, and [`wave-e2e.md`](wave-e2e.md) merges them.
