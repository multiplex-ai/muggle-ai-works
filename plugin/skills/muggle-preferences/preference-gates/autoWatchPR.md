# `autoWatchPR`

After a PR is sent at the end of a test run, controls whether Muggle starts a `muggle-pr-followup` watcher on it — a loop that polls the PR for newly submitted reviews and hands them to `/muggle-do` to address — or leaves you to start one yourself with `/mprfollowup`. Fires once a PR exists (muggle-test, muggle-test-feature-local), reusing the E2E validation context from that run so the watcher never re-prompts. Substitute `{pr}`.

**Picker 1** — header `Watch PR?`, question `"Watch '{pr}' for review follow-ups and address them as they land?"`
- `Watch it` — `Start a muggle-pr-followup loop on this PR.` → `always`
- `Ask me next time` — `Decide per run.` → `ask`
- `Skip — I'll watch it myself` — `Leave it; run /mprfollowup later if you want.` → `never`

**Silent action**
- `always` → `Watching {pr} for review follow-ups`
- `ask` → `Asking about PR watching`
- `never` → `Not watching {pr}`
