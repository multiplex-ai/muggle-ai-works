# `autoCleanup`

After a PR is merged, run the full cleanup sequence (worktree, branch, artifacts, `clean_gone`) — or skip. `always` runs all steps with no per-step prompts. Substitute `{branch}`.

**Picker 1** — header `Cleanup after merge`, question `"PR for {branch} is merged — run cleanup now?"`
- `Run cleanup` — `Remove worktree, delete branch local+remote, clear local artifacts, prune [gone] branches.` → `always`
- `Skip cleanup` — `Leave everything in place.` → `never`

**Silent action**
- `always` → `Running post-merge cleanup for {branch}`
- `never` → `Skipping post-merge cleanup for {branch}`
