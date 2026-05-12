# `autoCreatePR`

Controls whether the cycle pushes the working branch to remote and opens a pull request after local commits land, or stops at "commits made locally". Fires when the agent has buildable commits and no PR exists yet for the branch. Substitute `{branch}`.

**Picker 1** — header `Open PR?`, question `"Push '{branch}' and open a pull request?"`
- `Open the PR` — `Push branch and run gh pr create.` → `always`
- `Ask me next time` — `Decide per cycle.` → `ask`
- `Skip — I'll open it myself` — `Stop after the local commits.` → `never`

**Silent action**
- `always` → `Opening PR for {branch}`
- `ask` → `Asking about PR creation`
- `never` → `Skipping PR creation`
