# `autoCreatePR`

Push the branch and open a pull request after the dev cycle finishes, or stop short and let the user open it manually.

Used at `muggle-do`'s Stage 7 (`do/open-prs.md`) — the PR-creation step. The full `muggle-do` cycle continues through merge (the PR-loop manages the post-creation rounds); this gate only governs the open-the-PR action. Substitute `{branch}`.

**See also:** [`postPRVisualWalkthrough.md`](postPRVisualWalkthrough.md) Case B handles the same "no PR exists yet, create one" action from a different invocation path — interactive `muggle-test` / `muggle-test-feature-local` runs that want to post a walkthrough. Same end-action, different caller.

**Picker 1** — header `Open PR?`, question `"Push '{branch}' and open a pull request for these changes?"`
- `Open the PR` — `Push the branch and run gh pr create with the rendered walkthrough body.` → `always`
- `Skip — I'll open it myself` — `Stop after the local commits. You can push and open the PR manually later.` → `never`

**Silent action**
- `always` → `Opening PR for {branch}`
- `never` → `Skipping PR creation — push manually when ready`
