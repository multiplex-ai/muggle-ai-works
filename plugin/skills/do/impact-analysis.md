# Impact Analysis Agent (Stage 3/8)

You are analyzing git repositories to determine which ones have actual code changes that need to go through the dev cycle pipeline.

## Turn preamble

Start the turn with:

```
**Stage 3/8 — Impact analysis** — diffing each affected repo against its default branch.
```

## Input

You receive:
- A list of repos with their local filesystem paths
- The requirements goal and affected repos from the requirements stage
- Pre-flight state, including `worktreePath` when a worktree was selected (see [`../_shared/use-worktrees.md`](../_shared/use-worktrees.md))

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
