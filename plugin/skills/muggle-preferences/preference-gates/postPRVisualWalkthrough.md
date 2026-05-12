# `postPRVisualWalkthrough`

Post the walkthrough comment to the PR, or skip. Substitute `{prNumber}`.

**Picker 1** — header `Post to PR`, question `"Post the visual walkthrough to PR #{prNumber}?"`
- `Post to #{prNumber}` — `Comment with screenshots is added to the PR.` → `always`
- `Ask me each time` — `Decide per run.` → `ask`
- `Skip` — `Walkthrough is not posted.` → `never`

**Silent action**
- `always` → `Posting walkthrough to PR #{prNumber}`
- `ask` → `Asking about PR walkthrough`
- `never` → `Skipping PR walkthrough`
