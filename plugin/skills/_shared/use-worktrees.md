# Worktrees for Dev Work

Use this for feature development, local validation, and PR iteration.

## Core guidance

- **One worktree per branch.** Never switch branches inside a long-lived checkout.
- **Isolate runtime resources.** Parallel worktrees need unique ports and isolated mutable test state.
- **Keep worktrees disposable.** Create for focused work, remove after merge.

## Start new change work

Every new branch starts at the latest `origin/<base>` — never at HEAD, never at a local branch. The directory a session stands in may be a detached main checkout months old, or a sibling worktree on someone else's feature branch; a branch created without a start point silently inherits that code. A local `<base>` branch is no better: it is often checked out, stale, in another worktree.

1. Resolve `<main-root>` — the clone's main working tree, the first `worktree` line of `git worktree list --porcelain` — and `<base>` (the change's target branch; the remote default when none was chosen).
2. Fetch and create from the remote-tracking ref:
   ```bash
   git -C <main-root> fetch --no-tags origin "+refs/heads/<base>:refs/remotes/origin/<base>"
   git -C <main-root> worktree add <main-root>/.claude/worktrees/<sanitized-branch> -b <branch> origin/<base>
   ```
   Under `<main-root>` even when the session stands in another worktree, so worktrees never nest.
3. Confirm with `muggle checkout-freshness --cwd <worktree>` — it must report `FRESH`.
4. Install dependencies and run setup in that worktree.
5. Keep all edits and commits for the change in that same worktree.

## Test in the worktree

- Run lint, typecheck, and unit/integration tests from the worktree.
- Run your local E2E acceptance flow from that same worktree for user-facing validation.
- Run the dev server from the same worktree so code, env, and cache all match.
- In parallel runs, ensure each worktree has a unique port and isolated test data.

## E2E + worktree checklist

1. Confirm command cwd, checked-out branch, and server source are the same worktree, and that the worktree is still on the latest base per [`sync-branch-with-base.md`](sync-branch-with-base.md).
2. Start the app from that worktree and verify readiness first (see [`dev-server-readiness.md`](dev-server-readiness.md)).
3. Run local E2E acceptance checks in that same session.
4. Isolate test data across parallel branches (separate users/accounts/orgs or resettable fixtures).
5. Re-run E2E acceptance checks after meaningful code changes during PR review.

## Common failure modes to avoid

- **Mixed checkouts:** Test command and server run from different directories.
- **Port collision:** Multiple branches share a dev-server port.
- **Shared mutable state:** Parallel runs mutate the same account or fixtures.
- **Stale server:** Old process still serves previous branch code.
- **Inherited base:** A branch created from whatever HEAD the session stood on carries that checkout's age or another branch's commits.

## Pull request workflow

1. Commit on the branch tied to the worktree.
2. Push the branch and open the PR.
3. Keep review fixes in that same worktree.
4. Re-run relevant checks before each push, including E2E acceptance checks for user-facing changes.

## Tear down

After merge, remove the worktree.  
See [`post-merge-cleanup.md`](post-merge-cleanup.md).

**Never remove a worktree you are standing in.** Step back to the repo's main working tree first — `git worktree remove` refuses from inside, and a deleted working directory breaks every command that follows. Relocating is part of teardown, not a reason to stop and ask.
