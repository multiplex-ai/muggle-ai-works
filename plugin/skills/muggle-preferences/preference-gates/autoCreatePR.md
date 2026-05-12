# `autoCreatePR`

Push the branch and open a pull request, or stop. Substitute `{branch}`.

**Picker 1** — header `Open PR?`, question `"Push '{branch}' and open a pull request?"`
- `Open the PR` — `Push the branch and run gh pr create.` → `always`
- `Skip — I'll open it myself` — `Stop after the local commits.` → `never`

**Silent action**
- `always` → `Opening PR for {branch}`
- `never` → `Skipping PR creation`
