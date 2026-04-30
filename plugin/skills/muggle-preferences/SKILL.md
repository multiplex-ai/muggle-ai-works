---
name: muggle-preferences
description: >-
  View, set, or reset Muggle AI preferences that control testing behavior.
  Use when user asks to see preferences, change a setting, configure Muggle
  defaults, or manage muggle config. Triggers on: 'muggle preferences',
  'show muggle settings', 'change muggle preference', 'set autoLogin to
  always', 'muggle config', 'reset muggle preferences', 'show my muggle
  settings', 'configure muggle', 'muggle setup'.
---

# Muggle Preferences

View, set, or reset the preference knobs that control Muggle AI behavior.

## Operations

Parse the user's request to decide which operation to run:

- **List** — show current values. Default when no change is requested.
- **Configure** — interactive picker. Default when the user wants to change preferences but hasn't named a specific one (e.g. "muggle setup", "configure muggle", "change my preferences").
- **Set** — direct set when the user names a key+value (e.g. "set autoLogin to always").
- **Reset** — restore preferences to default (`ask`).

## Reading current values

Read preferences from session context. Look for the line starting with `Muggle Preferences` — it contains key=value pairs like `autoLogin=ask showElectronBrowser=always ...`.

If no preferences line is present, treat all preferences as `"ask"` (the default).

## List

Present all 12 preferences in this table, filling each `Value` column from session context:

```
Muggle AI — Preferences

| Preference               | Value  | Description                                              |
|--------------------------|--------|----------------------------------------------------------|
| autoLogin                | ask    | Reuse saved credentials without prompting                |
| autoSelectProject        | ask    | Reuse last-used project for this repo                    |
| showElectronBrowser      | ask    | Show browser window during local tests                   |
| openTestResultsAfterRun  | ask    | Open results page on dashboard after local test          |
| defaultExecutionMode     | ask    | Default to local or remote test execution                |
| autoPublishLocalResults  | ask    | Upload local results to Muggle cloud                     |
| suggestRelatedUseCases   | ask    | Suggest related use cases after creating/running one     |
| suggestRelatedTestCases  | ask    | Suggest related test cases after creating/running one    |
| autoDetectChanges        | ask    | Scan local git changes and map to affected test cases    |
| postPRVisualWalkthrough  | ask    | Post visual walkthrough with screenshots to PR           |
| checkForUpdates          | ask    | Check for newer Muggle version at session start          |
| verboseOutput            | ask    | Show detailed progress logs during execution             |

Values: always (proceed without asking) · ask (prompt each time) · never (skip without asking)
Scope:  global (~/.muggle-ai/) or project (.muggle-ai/ in repo root)
```

## Configure (interactive picker)

Use this whenever the user wants to change preferences without naming a specific key. The flow runs in a single `AskUserQuestion` call so the user can toggle preferences with the keyboard instead of typing key names.

### Step 1 — show current state

Print the preference table from the **List** section so the user sees what's set today.

### Step 2 — tell the user how to drive the picker

Print this instruction block verbatim before calling `AskUserQuestion`:

```
How to use this picker:
  ↑/↓        move between options
  space      toggle a preference (selected = set to `always`)
  tab        move to the next question
  enter      confirm

Anything you don't toggle keeps its current value. After this picker
you can tell me which (if any) should instead be set to `never`.
```

### Step 3 — call AskUserQuestion

Make a single `AskUserQuestion` call with these 4 questions. Group preferences so each question stays within the 4-option limit.

- **Question 1** — `header: "Auth & session"`, `multiSelect: true`
  Question text: `Which of these should auto-proceed (set to "always")?`
  Options (label / description):
  - `autoLogin` — Reuse saved credentials without prompting
  - `autoSelectProject` — Reuse last-used project for this repo
  - `checkForUpdates` — Check for newer Muggle version at session start
  - `verboseOutput` — Show detailed progress logs during execution

- **Question 2** — `header: "Test run"`, `multiSelect: true`
  Question text: `Which of these should auto-proceed (set to "always")?`
  Options:
  - `showElectronBrowser` — Show browser window during local tests
  - `openTestResultsAfterRun` — Open results page on dashboard after a local run
  - `autoPublishLocalResults` — Upload local results to Muggle cloud
  - `autoDetectChanges` — Scan local git changes and map to affected test cases

- **Question 3** — `header: "Suggestions & PR"`, `multiSelect: true`
  Question text: `Which of these should auto-proceed (set to "always")?`
  Options (3 — `defaultExecutionMode` is intentionally **excluded** here because it doesn't accept "always"; it's handled separately in Question 4):
  - `suggestRelatedUseCases` — Suggest related use cases after creating/running one
  - `suggestRelatedTestCases` — Suggest related test cases after creating/running one
  - `postPRVisualWalkthrough` — Post visual walkthrough with screenshots to PR

- **Question 4** — `header: "Default mode"`, `multiSelect: false`
  Question text: `Default execution mode for muggle-test? (preference: defaultExecutionMode)`
  Options:
  - `Local — run on my computer (Electron)` → `defaultExecutionMode = local`
  - `Remote — run in the Muggle cloud` → `defaultExecutionMode = remote`
  - `Ask each time` → `defaultExecutionMode = ask` (don't change)

- **Question 5** — `header: "Scope"`, `multiSelect: false`
  Question text: `Where should these preferences be saved?`
  Options:
  - `Global (all repos)` — Saved to ~/.muggle-ai/, applies everywhere
  - `This project only` — Saved to .muggle-ai/ in this repo

> **Note**: `AskUserQuestion` allows up to 4 questions per call. If you need 5, split into two sequential calls: Q1+Q2+Q3+Q4 first, then Q5 (scope).

### Step 4 — apply selections

For every preference the user toggled across **questions 1–3**, call `muggle-local-preferences-set` with:
- `key`: the preference name
- `value`: `"always"`
- `scope`: `"global"` or `"project"` based on the scope question (Q5)
- `cwd`: current working directory if scope is `"project"`

For **Question 4** (defaultExecutionMode), call `muggle-local-preferences-set` only if the user picked "Local" or "Remote" (skip if they picked "Ask each time"):
- `key: "defaultExecutionMode"`
- `value: "local"` or `"remote"` based on choice
- `scope`: from Q5
- `cwd`: current working directory if scope is `"project"`
- `cwd`: current working directory (required when scope is `"project"`)

### Step 5 — offer the `never` follow-up

After applying, ask: `Want any of these set to "never" (auto-skip without asking)? Name them, e.g. "never on autoPublishLocalResults", or say "no".`

If the user names keys, call `muggle-local-preferences-set` with `value: "never"` and the same scope.

### Step 6 — confirm

Print a short summary of what changed: `Set autoLogin=always, openTestResultsAfterRun=always (global).`

## Set (direct)

When the user names both key and value (e.g. "set autoLogin to always", "make showElectronBrowser never for this project"):

1. Parse the key and value from the user's message.

2. Validate the key is one of: `autoLogin`, `autoSelectProject`, `showElectronBrowser`, `openTestResultsAfterRun`, `defaultExecutionMode`, `autoPublishLocalResults`, `suggestRelatedUseCases`, `suggestRelatedTestCases`, `autoDetectChanges`, `postPRVisualWalkthrough`, `checkForUpdates`, `verboseOutput`.

   If the key is ambiguous or not recognized, show the full list and ask the user to clarify.

3. Validate the value is one of: `always`, `ask`, `never`.

4. Determine scope:
   - Default to `global`.
   - If the user says "for this project", "project-level", or "just this repo", use `project` scope and pass `cwd` as the current working directory.

5. Call `muggle-local-preferences-set` with the key, value, scope, and (if project scope) `cwd`.

6. Confirm: `Set {key} to {value} ({scope}).`

## Reset

1. If the user asks to reset a **specific key**: call `muggle-local-preferences-set` with `value: "ask"` for that key.

2. If the user asks to reset **all preferences**: call `muggle-local-preferences-set` for each of the 12 keys with `value: "ask"`.

3. Confirm what was reset.
