# `postPRVisualWalkthrough`

Preference gate. Controls whether the cycle posts the visual walkthrough comment (per-test-case dashboard links + step-by-step screenshots) to the PR after E2E results are available, or stops at "results ready". Fires once per E2E result set when a PR exists for the working branch (if it doesn't, callers fire [`autoCreatePR`](autoCreatePR.md) separately). Substitute `{prNumber}`.

**Picker 1** — header `Post to PR`, question `"Post the visual walkthrough to PR #{prNumber}?"`
- `Post to #{prNumber}` — `Comment with screenshots is added to the PR.` → `always`
- `Ask me each time` — `Decide per run.` → `ask`
- `Skip` — `Walkthrough is not posted.` → `never`

**Silent action**
- `always` → `Posting walkthrough to PR #{prNumber}`
- `ask` → `Asking about PR walkthrough`
- `never` → `Skipping PR walkthrough`
