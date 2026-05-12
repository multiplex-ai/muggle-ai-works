# Worktrees for Dev Work

Use this for feature development, local validation, and PR iteration.

## Core guidance

- **One worktree per branch.** Never switch branches inside a long-lived checkout.
- **Isolate runtime resources.** Parallel worktrees need unique ports and isolated mutable test state.
- **Keep worktrees disposable.** Create for focused work, remove after merge.

## Start new change work

1. Update the base branch (usually `main`).
2. Create a new worktree and branch:
   ```bash
   git worktree add <repo>-worktrees/<slug> -b <branch>
   ```
3. Install dependencies and run setup in that worktree.
4. Keep all edits and commits for the change in that same worktree.

## Test in the worktree

- Run lint, typecheck, and unit/integration tests from the worktree.
- Run your local E2E acceptance flow from that same worktree for user-facing validation.
- Run the dev server from the same worktree so code, env, and cache all match.
- In parallel runs, ensure each worktree has a unique port and isolated test data.

## E2E + worktree checklist

1. Confirm command cwd, checked-out branch, and server source are the same worktree.
2. Start the app from that worktree and verify readiness first (see [`dev-server-readiness.md`](dev-server-readiness.md)).
3. Run local E2E acceptance checks in that same session.
4. Isolate test data across parallel branches (separate users/accounts/orgs or resettable fixtures).
5. Re-run E2E acceptance checks after meaningful code changes during PR review.

## Common failure modes to avoid

- **Mixed checkouts:** Test command and server run from different directories.
- **Port collision:** Multiple branches share a dev-server port.
- **Shared mutable state:** Parallel runs mutate the same account or fixtures.
- **Stale server:** Old process still serves previous branch code.

## Pull request workflow

1. Commit on the branch tied to the worktree.
2. Push the branch and open the PR.
3. Keep review fixes in that same worktree.
4. Re-run relevant checks before each push, including E2E acceptance checks for user-facing changes.

## Tear down

After merge, remove the worktree.  
See [`post-merge-cleanup.md`](post-merge-cleanup.md).
