# `autoCreatePR`

Push the branch and open a pull request after the dev cycle finishes, or stop short and let the user open it manually.

Used at the end of `muggle-do` (stage 7, `do/open-prs.md`). Substitute `{branch}`.

**Picker 1** — header `Open PR?`, question `"Push '{branch}' and open a pull request for these changes?"`
- `Open the PR` — `Push the branch and run gh pr create with the rendered walkthrough body.` → `always`
- `Skip — I'll open it myself` — `Stop after the local commits. You can push and open the PR manually later.` → `never`

**Silent action**
- `always` → `Opening PR for {branch}`
- `never` → `Skipping PR creation — push manually when ready`
