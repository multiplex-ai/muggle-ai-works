# `postPRVisualWalkthrough`

Post a visual walkthrough of test results to a PR.

**PR detection (mandatory before any picker).** Run `gh pr view --json number,title,url 2>/dev/null` first. The result picks Case A or B.
Substitute `{prNumber}`, `{prTitle}` into prompts.

## Case A — open PR found

**Picker 1** — header `Share with the team`, question `"Post a visual walkthrough to PR #{prNumber} ({prTitle})?"`
- `Yes, post to #{prNumber}` — `Reviewers see clickable per-test screenshots and dashboard links.` → `always`
- `Skip` — `Keep it off the PR — you can post later from the dashboard.` → `never`

**Silent action (Case A)**
- `always` → `Posting walkthrough to PR #{prNumber}`
- `never` → `Skipping PR walkthrough for #{prNumber}`

## Case B — no open PR

Situational fork — saved value is *not* updated from this picker.

**Picker 1** — header `No PR yet`, question `"This branch has no open PR. Create one and post the walkthrough, or skip?"`
- `Create a PR and post` — `I'll open a PR for this branch, then attach the walkthrough.` → run PR-creation flow (calling skill's responsibility), then post.
- `Skip` — `Skip the walkthrough this time — you can post later from the dashboard.` → continue.

**Picker 2** — skipped entirely.

**Silent action (Case B)** — when saved gate is `always` or `never` but no PR exists:
- `always` → fall through to Case B Picker 1 (don't auto-create silently). Print: `(`postPRVisualWalkthrough = always`, but this branch has no PR — asking what to do.)`
- `never` → `Skipping PR walkthrough — no open PR for this branch`
