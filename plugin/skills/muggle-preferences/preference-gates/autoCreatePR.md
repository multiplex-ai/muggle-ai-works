# `autoCreatePR`

Push the branch and open a pull request, or skip. Substitute `{branch}`.

**Picker 1** — header `Open PR?`, question `"Push '{branch}' and open a pull request?"`
- `Open the PR` — `Push branch and run gh pr create.` → `always`
- `Ask me next time` — `Decide per cycle.` → `ask`
- `Skip — I'll open it myself` — `Stop after the local commits.` → `never`

**Silent action**
- `always` → `Opening PR for {branch}`
- `ask` → `Asking about PR creation`
- `never` → `Skipping PR creation`
