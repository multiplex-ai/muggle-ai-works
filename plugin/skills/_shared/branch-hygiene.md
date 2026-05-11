# Branch Hygiene for Local Dev & E2E

Three small habits that keep local development clean and avoid running tests against stale code. All three are **recommendations** — surface them via `AskUserQuestion` and let the user opt out. Never run destructive git commands without confirmation.

## 1. Use a worktree for the change (recommended, not enforced)

When the user is about to start meaningful development or write-up work (more than a quick edit), recommend creating a git worktree so the current checkout stays untouched.

- **Surface it as a choice**, not a requirement, via `AskUserQuestion`:
  - "Create a worktree for this change (recommended)"
  - "Work directly in the current checkout"
- **Skip the prompt** if the work is trivial (typo fix, one-line config tweak) or the user has already opted out in this session.
- **How to create** — see the `superpowers:using-git-worktrees` skill. Don't reinvent the workflow here.

## 2. Rebase onto the default branch before running the dev server or E2E tests

Before starting a dev server or running E2E acceptance tests on a local branch, check whether the branch is behind `origin/<default>`:

```bash
git fetch origin
default=$(git symbolic-ref refs/remotes/origin/HEAD --short | sed 's|origin/||')
behind=$(git rev-list --count "HEAD..origin/${default}")
```

If `behind > 0`, surface a recommendation via `AskUserQuestion`:

- "Rebase onto `origin/<default>` first (recommended — `behind` commits behind)"
- "Run anyway against the current branch"

**Why:** dev servers and E2E tests against a stale branch can reproduce bugs that were already fixed on the default branch, or miss interactions with newly-merged code. The result: false failures or false greens that waste the user's review time.

If the rebase has conflicts, stop and report — do not attempt to resolve automatically.

## 3. Cleanup after the change is merged

Once the PR is merged, recommend the following cleanup. Confirm each destructive command via `AskUserQuestion` before running it.

1. **Delete the worktree** (if one was created for this change):
   ```bash
   git worktree remove <path>
   ```

2. **Delete the local + remote branch:**
   ```bash
   git branch -d <branch>
   git push origin --delete <branch>
   ```

3. **Clean up local Muggle Test artifacts** from the merged work:
   - Local run screenshots and session folders under `.muggle-ai/` for this branch's runs.
   - Stale `/tmp/muggle-prepare-*.log` files if `muggle-test-prepare` was used.
   - **Cloud results stay** on the Muggle Test dashboard — only local artifacts are removed.

4. **Prune any other `[gone]` branches and their worktrees** by invoking the existing `commit-commands:clean_gone` skill via the `Skill` tool. This catches branches whose remote was deleted but local copies linger.

All four steps are recommendations — the user always gets the final say.
