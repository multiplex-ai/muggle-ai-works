---
name: muggle-preferences
description: >-
  View, set, or reset Muggle AI preferences that control testing behavior.
  Use when user asks to see preferences, change a setting, configure Muggle
  defaults, or manage muggle config. Triggers on: 'muggle preferences',
  'show muggle settings', 'change muggle preference', 'set autoLogin to
  always', 'muggle config', 'reset muggle preferences', 'show my muggle
  settings', 'configure muggle'.
---

# Muggle Preferences

View, set, or reset the preference knobs that control Muggle AI behavior.

## Operations

Parse the user's request to determine which operation to perform:

- **List** — user wants to see current values (default when no specific change requested)
- **Set** — user wants to change a specific preference
- **Reset** — user wants to restore a preference (or all preferences) to defaults

## List

1. Read preferences from session context. Look for the line starting with `Muggle Preferences` — it contains key=value pairs like `autoLogin=ask showElectronBrowser=always ...`.

   If no preferences line is present, treat all preferences as `"ask"` (the default).

2. Present all 12 preferences in a table:

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

## Set

1. Parse the requested key and value from the user's message.

2. Validate the key is one of: `autoLogin`, `autoSelectProject`, `showElectronBrowser`, `openTestResultsAfterRun`, `defaultExecutionMode`, `autoPublishLocalResults`, `suggestRelatedUseCases`, `suggestRelatedTestCases`, `autoDetectChanges`, `postPRVisualWalkthrough`, `checkForUpdates`, `verboseOutput`.

   If the key is ambiguous or not recognized, show the full list and ask the user to clarify.

3. Validate the value is one of: `always`, `ask`, `never`.

4. Determine scope:
   - Default to `global`.
   - If the user says "for this project", "project-level", or "just this repo", use `project` scope and pass `cwd` as the current working directory.

5. Call `muggle-local-preferences-set` with:
   - `key`: The preference key
   - `value`: The chosen value
   - `scope`: `"global"` or `"project"`
   - `cwd`: Current working directory (required when scope is `"project"`)

6. Confirm: `Set {key} to {value} ({scope}).`

## Reset

1. If the user asks to reset a **specific key**: call `muggle-local-preferences-set` with `value: "ask"` for that key.

2. If the user asks to reset **all preferences**: call `muggle-local-preferences-set` for each of the 12 keys with `value: "ask"`.

3. Confirm what was reset.
