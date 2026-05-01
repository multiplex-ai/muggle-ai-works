# Preference Gates

Single source of truth for the user-facing prompts and silent-mode messages
of every preference-gated decision in Muggle skills.

Skills should not redefine these prompts inline. They reference this doc and
add only the step-specific side effects (the API call, the URL to open, etc.).

---

## How a gate fires

User preferences are injected by the `SessionStart` hook into a
`Muggle Preferences` line in session context (`key=value` pairs). Resolution:
defaults → `~/.muggle-ai/preferences.json` (global) →
`<repo>/.muggle-ai/preferences.json` (project). Treat absent prefs as `ask`.

For every gated decision, branch on the value:

- `always` → take the pro-action **silently**, then print the silent-mode footer.
- `never` → take the skip-action **silently**, then print the silent-mode footer.
- `ask` (or absent) → run the **2-picker flow** below.

`defaultExecutionMode` substitutes `local`/`remote` for `always`/`never`. Same
shape, different value names.

---

## Silent-mode footer (mandatory whenever pickers are skipped)

Whenever a gate fires `always` / `never` (or `local` / `remote`) and skips
the pickers, append a single line directly under the action you took, in this
exact shape:

```
✓ <one-liner from the per-key entry>. Change with `/muggle-preferences <key>`.
```

`<key>` is the literal preference key (e.g. `autoLogin`). The slash command
re-runs Picker 1 for that key (Picker 2 is skipped — saving immediately is
the whole point of the override).

Goal: no silent gate ever leaves the user wondering "why did this happen
without asking me, and how do I undo it?"

---

## Picker 1 (per key — defined below)

`AskQuestion` with the header, question, and options from the matching per-key
entry. Each option carries a mapped value (`always` / `never`, or
`local` / `remote` for `defaultExecutionMode`).

After Picker 1 resolves, perform the side effect for the chosen value (auth,
publish, open URL, etc. — defined in the calling skill, not here).

---

## Picker 2 — Save this choice? (shared template)

After Picker 1 resolves, run a second `AskQuestion` to ask whether to persist
the choice. **Use this template for every gate** unless the per-key entry
overrides it.

- **Header:** `Save this choice?`
- **Question:** `"Always <restate the Picker 1 choice in plain language> from now on, without asking?"`
  Examples: `"Always run hidden from now on, without asking?"`,
  `"Always reuse this login from now on, without asking?"`.
  Never put the raw preference key or `=` into the user-visible question.
- **Options:**
  - `Yes, always` — sub-label: `You can change this later in muggle preferences.` → call `muggle-local-preferences-set` with `key`, the value mapped from the Picker 1 choice, `scope: "global"`.
  - `Just this once` — sub-label: `I'll ask again next time.` → continue without saving.

**Saved-value invariant:** the value persisted in Picker 2 MUST match the
Picker 1 choice. Picking the pro-action and saving `never` (or vice versa)
is a bug. The per-key entry below states the exact mapping.

---

## Re-prompting via `/muggle-preferences <key>`

When the user invokes `/muggle-preferences <key>` (the silent-mode footer
command), run **Picker 1 only** for that key, then immediately call
`muggle-local-preferences-set` with the chosen value and `scope: "global"`.
**Skip Picker 2** — the user explicitly asked to change the setting; asking
"do you want to remember this?" again is just noise.

This is the only entry-point that re-runs a single gate's Picker 1 outside
of its calling skill.

---

# Per-key gates

Each entry below defines: what the gate decides, the Picker 1 spec, the
silent-mode footer wording for each value, and any deviations from the
shared Picker 2 template.

---

## `autoLogin`

**Decides:** reuse the saved Muggle session, or force a fresh login.
**Substitute `{email}`** (the signed-in account) into the Picker 1 question.

**Picker 1**
- Header: `You're already logged in`
- Question: `"Continue as {email}, or sign in with a different account?"`
- Options:
  - `Continue as me` — sub: `Reuse this session for the rest of this run.` → `always`
  - `Switch account` — sub: `Sign out and log in fresh.` → `never`

**Silent footer**
- `always` → `✓ Continuing as {email}. Change with `/muggle-preferences autoLogin`.`
- `never`  → `✓ Forcing a fresh login. Change with `/muggle-preferences autoLogin`.`

---

## `autoSelectProject`

**Decides:** reuse the cached Muggle project for this repo (from
`<cwd>/.muggle-ai/last-project.json`), or pick one from the list.
**Substitute `{projectName}`** into prompts where indicated.

This gate's Picker 1 is unusual: when `ask`, the Picker 1 *is* the project
list (the user's first interaction is picking a project). The "save this
choice" question fires only after they pick an existing project.

**Picker 1** — (the project picker that the calling skill renders; not a
yes/no — see the calling skill's project-selection section).

**Picker 2 — overrides the shared template** (only fires when the user
picked an *existing* project; skipped when they picked "Create new project")
- Header: `Reuse this project next time?`
- Question: `"Always reuse {projectName} for this repo from now on, without asking?"`
- Options:
  - `Yes, always` — sub: `You can change this later in muggle preferences.` → call BOTH:
    1. `muggle-local-preferences-set` with `key: "autoSelectProject"`, `value: "always"`, `scope: "global"`
    2. `muggle-local-last-project-set` with `cwd`, `projectId`, `projectUrl`, `projectName`
  - `Just this once` — sub: `I'll ask again next time.` → continue without saving.

**Silent footer**
- `always` (cached project used) → `✓ Using saved project {projectName}. Change with `/muggle-preferences autoSelectProject`.`
- `never` (full list shown) → no footer needed; the picker IS the visible step.

---

## `showElectronBrowser`

**Decides:** show the Electron browser window during local test execution,
or run it hidden.

**Picker 1**
- Header: `Browser window`
- Question: `"Show the test browser as it runs?"`
- Options:
  - `Show it` — sub: `Watch the test live — useful when something's failing.` → `always` (omit `showUi`)
  - `Run hidden` — sub: `Skip watching — let it run in the background while you do other things.` → `never` (pass `showUi: false`)

**Silent footer**
- `always` → `✓ Showing the browser. Change with `/muggle-preferences showElectronBrowser`.`
- `never`  → `✓ Running hidden. Change with `/muggle-preferences showElectronBrowser`.`

---

## `openTestResultsAfterRun`

**Decides:** auto-open the Muggle dashboard for this run, or just print the URL.

**Picker 1**
- Header: `After the run`
- Question: `"Open the test results in your browser when this finishes?"`
- Options:
  - `Open the dashboard` — sub: `See screenshots, step details, and pass/fail at a glance.` → `always`
  - `Just print the link` — sub: `Skip auto-open — I'll just hand you the URL.` → `never`

**Silent footer**
- `always` → `✓ Opening results on the dashboard. Change with `/muggle-preferences openTestResultsAfterRun`.`
- `never`  → `✓ Just printing the link — no auto-open. Change with `/muggle-preferences openTestResultsAfterRun`.`

---

## `defaultExecutionMode` (special: `local` / `remote` / `ask`)

**Decides:** local Electron browser or Muggle cloud as the default place to
run tests when the user's request is ambiguous.

**Picker 1**
- Header: `Where to run tests?`
- Question: `"On your computer or in the cloud?"`
- Options:
  - `On my computer` — sub: `Real browser on localhost. Faster feedback while developing.` → `local`
  - `In the cloud` — sub: `Muggle's cloud runs against a preview/staging URL.` → `remote`

When the user's intent is already clear from their query (e.g. they said
"test on staging"), skip Picker 1 — confirm with a one-shot
`"Yes, proceed in <mode>"` / `"Switch to <other mode>"` instead, and skip
Picker 2.

**Silent footer**
- `local`  → `✓ Running on your computer. Change with `/muggle-preferences defaultExecutionMode`.`
- `remote` → `✓ Running in the cloud. Change with `/muggle-preferences defaultExecutionMode`.`

---

## `autoPublishLocalResults`

**Decides:** upload local run artifacts to the Muggle cloud after a local run.

**Picker 1**
- Header: `Share results?`
- Question: `"Upload these results to the Muggle dashboard?"`
- Options:
  - `Upload them` — sub: `Needed for the dashboard view, PR walkthrough, and team visibility.` → `always`
  - `Keep local-only` — sub: `Stay on this machine — no dashboard view or PR walkthrough.` → `never`

**Silent footer**
- `always` → `✓ Uploading to the dashboard. Change with `/muggle-preferences autoPublishLocalResults`.`
- `never`  → `✓ Keeping results local. Change with `/muggle-preferences autoPublishLocalResults`.`

---

## `suggestRelatedUseCases`

**Decides:** after creating/running a use case, surface related ones already
in the project.

**Picker 1**
- Header: `Related use cases`
- Question: `"Surface related use cases already in this project?"`
- Options:
  - `Yes, suggest related` — sub: `Catch use cases your import or change might have missed.` → `always`
  - `No, skip` — sub: `Don't show suggestions — I'll ask if I want them later.` → `never`

**Silent footer**
- `always` → `✓ Showing related use cases below. Change with `/muggle-preferences suggestRelatedUseCases`.`
- `never`  → `✓ Skipping use case suggestions. Change with `/muggle-preferences suggestRelatedUseCases`.`

---

## `suggestRelatedTestCases`

**Decides:** after creating/running a test case, surface related ones already
attached to the use case.

**Picker 1**
- Header: `Related test cases`
- Question: `"Surface related test cases already attached to this use case?"`
- Options:
  - `Yes, suggest related` — sub: `Catch test cases your import or change might have missed.` → `always`
  - `No, skip` — sub: `Don't show suggestions — I'll ask if I want them later.` → `never`

**Silent footer**
- `always` → `✓ Showing related test cases below. Change with `/muggle-preferences suggestRelatedTestCases`.`
- `never`  → `✓ Skipping test case suggestions. Change with `/muggle-preferences suggestRelatedTestCases`.`

---

## `autoDetectChanges`

**Decides:** scan local git changes to scope the test run, or skip the scan
and let the user say what to test.

**Picker 1**
- Header: `Local git scan`
- Question: `"Scan git changes to scope what to test?"`
- Options:
  - `Yes, scan changes` — sub: `Test cases that match recent diffs get prioritized.` → `always`
  - `No, I'll specify` — sub: `Skip the scan — I'll tell you what to test.` → `never`

**Silent footer**
- `always` → `✓ Scanning git changes to scope the run. Change with `/muggle-preferences autoDetectChanges`.`
- `never`  → `✓ Skipping git scan — please tell me what to test. Change with `/muggle-preferences autoDetectChanges`.`

---

## `postPRVisualWalkthrough`

**Decides:** post a visual walkthrough of test results to a PR.

**PR detection (mandatory before Picker 1).** Before running the gate, the
calling skill MUST detect whether the current branch has an open PR:

```bash
gh pr view --json number,title,url 2>/dev/null
```

The result drives which Picker 1 shape to use, and which silent-mode footer
to print. **Substitute `{prNumber}`, `{prTitle}`, `{prUrl}`** into prompts
where indicated.

### Case A — open PR found

**Picker 1**
- Header: `Share with the team`
- Question: `"Post a visual walkthrough to PR #{prNumber} ({prTitle})?"`
- Options:
  - `Yes, post to #{prNumber}` — sub: `Reviewers see clickable per-test screenshots and dashboard links.` → `always`
  - `Skip` — sub: `Keep it off the PR — you can post later from the dashboard.` → `never`

**Silent footer (Case A)**
- `always` → `✓ Posting walkthrough to PR #{prNumber}. Change with `/muggle-preferences postPRVisualWalkthrough`.`
- `never`  → `✓ Skipping PR walkthrough for #{prNumber}. Change with `/muggle-preferences postPRVisualWalkthrough`.`

### Case B — no open PR for the current branch

**Picker 1** (gate value is *not* mapped to `always` / `never` here — this is
a one-off fork; the saved value should reflect intent for future runs that
*do* have a PR, not the create-PR detour the user is taking now)
- Header: `No PR yet`
- Question: `"This branch has no open PR. Create one and post the walkthrough, or skip?"`
- Options:
  - `Create a PR and post` — sub: `I'll open a PR for this branch, then attach the walkthrough.` → run PR-creation flow (calling skill's responsibility), then post; **do not** save a preference value from this choice.
  - `Skip` — sub: `Skip the walkthrough this time — you can post later from the dashboard.` → continue without posting; **do not** save a preference.

**Picker 2 — overrides the shared template (Case B only):** skip Picker 2
entirely. The user's choice was situational ("there's no PR, what now?"),
not a durable preference.

**Silent footer (Case B)** — applies when the saved gate is `always` or
`never` but no PR exists. The gate cannot be applied silently because
auto-creating PRs without consent is not safe.
- `always` (no PR) → fall through to Case B Picker 1; do not act silently. Print: `(`postPRVisualWalkthrough = always`, but this branch has no PR — asking what to do.)`
- `never` (no PR) → still skip silently, but print: `✓ Skipping PR walkthrough — no open PR for this branch. Change with `/muggle-preferences postPRVisualWalkthrough`.`

---

## `checkForUpdates`

**Decides:** check npm for a newer Muggle version at session start.

**Picker 1**
- Header: `Update check`
- Question: `"Check npm for a newer Muggle version? Requires a network call."`
- Options:
  - `Yes, check` — sub: `Quick network call — flags if you're behind.` → `always`
  - `No, skip` — sub: `Skip the check — saves a network call at session start.` → `never`

**Silent footer**
- `always` → `✓ Checked for updates. Change with `/muggle-preferences checkForUpdates`.`
- `never`  → `✓ Skipped update check. Change with `/muggle-preferences checkForUpdates`.`
