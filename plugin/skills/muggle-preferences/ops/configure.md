# Configure (interactive picker)

Use whenever the user wants to change preferences without naming a specific key. Drives selections through `AskUserQuestion` so they toggle with the keyboard instead of typing key names.

## Step 1 — show current state

Print the preference table per `ops/list.md` so the user sees what's set today.

## Step 2 — usage instructions

Print verbatim before calling `AskUserQuestion`:

```
How to use this picker:
  ↑/↓        move between options
  space      toggle a preference (selected = set to `always`)
  tab        move to the next question
  enter      confirm

Anything you don't toggle keeps its current value. After this picker
you can tell me which (if any) should instead be set to `never`.
```

## Step 3 — call AskUserQuestion

For each option: label = key name, description = first paragraph of `preference-gates/<key>.md`. Multi-select question text = `Which of these should auto-proceed (set to "always")?`; selected = `always`.

- `multiSelect: true`, `header: "Auth & session"` — `autoLogin`, `autoSelectProject`, `checkForUpdates`, `verboseOutput`
- `multiSelect: true`, `header: "Test setup"` — `localDevHost`, `autoDetectChanges`
- `multiSelect: true`, `header: "Test run"` — `showElectronBrowser`, `openTestResultsAfterRun`, `autoPublishLocalResults`
- `multiSelect: true`, `header: "Suggestions & PR"` — `suggestRelatedUseCases`, `suggestRelatedTestCases`, `postPRVisualWalkthrough`
- `multiSelect: false`, `header: "Default mode"` — `defaultExecutionMode`. Options: `Local — run on my computer` (`local`), `Remote — run in the Muggle cloud` (`remote`), `Ask each time` (don't change).
- `multiSelect: false`, `header: "Scope"` — final scope question. Options: `Global (all repos)` (~/.muggle-ai/), `This project only` (.muggle-ai/ in repo).

`AskUserQuestion` accepts up to 4 questions per call — split into two calls if needed (categories first, scope second).

## Step 4 — apply selections

For each toggled key (multi-select questions): `muggle-local-preferences-set` with `value: "always"`. For `defaultExecutionMode`: only set if user picked Local/Remote (skip "Ask each time"). Pass `scope` from the scope question; pass `cwd` when scope is `project`.

## Step 5 — `never` follow-up

Ask: `Want any of these set to "never" (auto-skip without asking)? Name them, e.g. "never on autoPublishLocalResults", or say "no".`. For named keys, call `muggle-local-preferences-set` with `value: "never"`, same scope.

## Step 6 — confirm

One-liner summary: `Set autoLogin=always, openTestResultsAfterRun=always (global).`
