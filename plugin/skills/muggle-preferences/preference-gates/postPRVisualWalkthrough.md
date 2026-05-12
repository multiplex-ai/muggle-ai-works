# `postPRVisualWalkthrough`

Post the visual walkthrough comment to the PR.

Substitute `{prNumber}`, `{prTitle}`.

**Picker 1** — header `Post to PR`, question `"Post the visual walkthrough to PR #{prNumber} ({prTitle})?"`
- `Post to #{prNumber}` — `Reviewers see clickable per-test screenshots and dashboard links.` → `always`
- `Skip` — `Keep it off the PR — you can post later from the dashboard.` → `never`

**Silent action**
- `always` → `Posting walkthrough to PR #{prNumber}`
- `never` → `Skipping PR walkthrough`
