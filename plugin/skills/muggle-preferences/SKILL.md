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
- **Change one** — re-run the gate's picker for a single key. Use this when the user invokes `/muggle-preferences <key>` or says "change my <key> preference".
- **Configure** — interactive picker covering all keys at once. Default when the user wants to change preferences but hasn't named a specific one (e.g. "muggle setup", "configure muggle", "change my preferences").
- **Set** — direct set when the user names a key+value (e.g. "set autoLogin to always").
- **Reset** — restore preferences to default (`ask`).

Per-key files live in `preference-gates/` — one `<key>.md` per key, plus `README.md` for the contract (`always`/`never`/`ask`, Picker 2 template, silent footer, re-prompt rule). The full key list = `ls preference-gates/*.md` minus `README.md`.

## Reading current values

Read preferences from session context. Look for the line starting with `Muggle Preferences` — it contains key=value pairs like `autoLogin=ask showElectronBrowser=always ...`.

If no preferences line is present, treat all preferences as `"ask"` (the default).

## List

Render a `Preference | Value | Description` table titled `Muggle AI — Preferences`.
- Keys: every `preference-gates/<key>.md` (excluding `README.md`).
- Values: from session context (default `ask`).
- Description: each gate file's first paragraph.

Footer:
```
Values: always · ask · never (defaultExecutionMode: local/remote/ask)
Scope:  global (~/.muggle-ai/) or project (.muggle-ai/ in repo root)
```

## Change one (single-key picker)

Use this when the user invokes `/muggle-preferences <key>` or says "change my <key> preference" / "show me the <key> options". Behavior:

1. Check that `preference-gates/<key>.md` exists. If not, list `preference-gates/*.md` and ask.
2. Open it, run **Picker 1 only**.
3. Call `muggle-local-preferences-set` with the mapped value, `scope: "global"`. **Skip Picker 2** (user explicitly asked to change).
4. Confirm: `Set <key> to <value>.`

This is the entry point that silent-mode footers point at, so its UX must mirror the per-key gate exactly — same question, same options, same mappings.

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

Group keys into categories below (only place this UX grouping lives — not in the gate dir). For each option: label = key name, description = first paragraph of `preference-gates/<key>.md`.

- `multiSelect: true`, `header: "Auth & session"` — `autoLogin`, `autoSelectProject`, `checkForUpdates`, `verboseOutput`
- `multiSelect: true`, `header: "Test run"` — `showElectronBrowser`, `openTestResultsAfterRun`, `autoPublishLocalResults`, `autoDetectChanges`
- `multiSelect: true`, `header: "Suggestions & PR"` — `suggestRelatedUseCases`, `suggestRelatedTestCases`, `postPRVisualWalkthrough`
- `multiSelect: false`, `header: "Default mode"` — `defaultExecutionMode`. Options: `Local — run on my computer` (`local`), `Remote — run in the Muggle cloud` (`remote`), `Ask each time` (don't change).
- `multiSelect: false`, `header: "Scope"` — final scope question. Options: `Global (all repos)` (~/.muggle-ai/), `This project only` (.muggle-ai/ in repo).

For the multi-select questions: text = `Which of these should auto-proceed (set to "always")?`; selected = `always`.

`AskUserQuestion` accepts up to 4 questions per call — split into two calls if needed (categories first, scope second).

### Step 4 — apply selections

For each toggled key (multi-select questions): `muggle-local-preferences-set` with `value: "always"`. For `defaultExecutionMode`: only set if user picked Local/Remote (skip "Ask each time"). Pass `scope` from the scope question; pass `cwd` when scope is `project`.

### Step 5 — offer the `never` follow-up

Ask: `Want any of these set to "never" (auto-skip without asking)? Name them, e.g. "never on autoPublishLocalResults", or say "no".`. For named keys, call `muggle-local-preferences-set` with `value: "never"`, same scope.

### Step 6 — confirm

Print a one-liner summary: `Set autoLogin=always, openTestResultsAfterRun=always (global).`

## Set (direct)

When the user names both key and value (e.g. "set autoLogin to always", "make showElectronBrowser never for this project"):

1. Parse `key` and `value` from the user's message.
2. Validate `key`: `preference-gates/<key>.md` must exist. If not, list `preference-gates/*.md` and ask.
3. Validate `value`: must be `always`/`never`/`ask` for all keys; `defaultExecutionMode` accepts `local`/`remote`/`ask` instead.
4. Scope defaults to `global`. If user says "for this project" / "just this repo", use `project` and pass `cwd`.
5. Call `muggle-local-preferences-set`.
6. Confirm: `Set {key} to {value} ({scope}).`

## Reset

- Specific key: `muggle-local-preferences-set` with `value: "ask"` for that key.
- All preferences: same call for every `preference-gates/<key>.md`.

Confirm what was reset.
