# `autoInstallCiWorkflow`

Controls whether Muggle adds `.github/workflows/muggle-walkthrough.yml` — the CI check that fails a pull request whose E2E walkthrough is missing or reports a failed or inconclusive test case — to a GitHub repository that lacks it. Fires when `muggle init` runs inside such a repository, and when `/muggle-do` is about to open a PR from one. Never fires where the workflow already exists or the repository is not on GitHub. Substitute `{repo}`.

**Picker 1** — header `CI check`, question `"Add the Muggle E2E check to {repo}'s CI? Pull requests then fail while their walkthrough is missing or reports a failed test."`
- `Add it` — `Run muggle ci-install and ship the workflow with this change.` → `always`
- `Ask me next time` — `Decide per repository.` → `ask`
- `Skip — leave CI alone` — `Don't add the workflow; muggle ci-install adds it later.` → `never`

**Silent action**
- `always` → `Adding the Muggle E2E check to {repo}'s CI`
- `ask` → `Asking about the Muggle E2E check for {repo}`
- `never` → `Leaving {repo}'s CI without the Muggle E2E check`
