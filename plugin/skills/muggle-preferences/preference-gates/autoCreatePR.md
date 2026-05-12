# `autoCreatePR`

Push the branch and open a pull request, or stop. Used at `muggle-do` Stage 7 ([`do/open-prs.md`](../../do/open-prs.md)). Substitute `{branch}`.

**Picker 1** — header `Open PR?`, question `"Push '{branch}' and open a pull request for these changes?"`
- `Open the PR` — `Push the branch and run gh pr create with the rendered walkthrough body.` → `always`
- `Skip — I'll open it myself` — `Stop after the local commits. You can push and open the PR manually later.` → `never`

**Silent action**
- `always` → `Opening PR for {branch}`
- `never` → `Skipping PR creation — push manually when ready`
