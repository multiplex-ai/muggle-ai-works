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

**Explicit request** — when the user's own words for this run ask for the PR ("open the PR", "raise a PR", "put up a PR"), take the `always` action for this run whatever the saved value, with the footer ``(You asked for the PR — overriding `autoCreatePR=<value>` for this run.)``. Invoking a skill whose job ends in a PR is not such a request. A request silent on the PR leaves the saved value in charge, and the saved value never changes. The request lifts this gate only, never a halt or an unmet Definition of Done line.
