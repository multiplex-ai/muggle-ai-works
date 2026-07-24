# Signed commits without local signing

**Never push unsigned commits.** When the machine has no working signing setup, do not fall back to unsigned `git commit` + `git push` — create the commits **remotely** with GraphQL `createCommitOnBranch`, which GitHub signs server-side. And never "fix" a signing failure by disabling it: no `--no-gpg-sign`, no `-c commit.gpgsign=false` — a broken signing setup is fixed or routed around via the remote path, not turned off.

## Preflight

```bash
git -C <repo-path> log --format='%G?' origin/<branch>..HEAD   # unpushed branch: <base>..HEAD
```

Any `N` (no signature) among the commits about to leave the machine → the push is blocked; use the remote path below. `G`/`E`/`U` are signed commits (locally unverifiable is fine — GitHub-signed commits show `E` without GitHub's key in the local keyring). Signing configured and working → commit and push normally.

## Remote signed commit

1. The branch must exist on the remote; create it at the base if absent: `gh api repos/<owner>/<repo>/git/refs -f ref=refs/heads/<branch> -f sha=<base-sha>`.
2. Stage the change (`git add <files>`), then take each file's canonical bytes from the **index** — `git cat-file blob :<path>` — and base64 them. Index blobs, never working-copy reads: the index holds git's normalized content (line endings, filters), so the remote tree matches what a local commit would have produced.
3. One `createCommitOnBranch` mutation per commit: `branch {repositoryNameWithOwner, branchName}`, `message {headline, body}`, `expectedHeadOid` = the branch's current remote head (a concurrency lease — a concurrent push 409s instead of being clobbered), `fileChanges.additions` (path + base64 contents; removals via `fileChanges.deletions`).
4. Sync the local branch to the result: `git fetch origin <branch>`, verify `git diff --cached origin/<branch>` is **empty** (remote tree identical to what was staged), then `git reset --hard origin/<branch>`. A non-empty diff means the payload missed a file — fix and re-commit; never leave local and remote diverged.

## Rebase / force-push

A local rebase mints new local commits — unsigned on this machine — so the `--force-with-lease` path is equally blocked. Replay instead:

1. Create a temp ref at the new base tip.
2. Re-create each branch commit on it via `createCommitOnBranch` (same per-commit file snapshots from `git cat-file blob <commit>:<path>`; conflicted files carry the resolved content).
3. Move the branch ref with a lease: verify the branch's current remote head is still the expected pre-rebase SHA, then `gh api -X PATCH repos/<owner>/<repo>/git/refs/heads/<branch> -f sha=<new-head> -F force=true`. Delete the temp ref.

The replayed commits are GitHub-signed; the guarded ref move is the only force operation.
