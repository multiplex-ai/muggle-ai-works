# Cleanup After the Change Is Merged

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
