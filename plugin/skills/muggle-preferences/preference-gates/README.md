# Preference Gates — Contract

One file per gate in this directory. Skills load this contract + only the
gates they actually fire.

## Keys

12 keys total, grouped by category. Each key's description and value
mappings live in its own `<key>.md` file — read that, don't restate it
here. Default allowed values: `always` / `never` / `ask`.

- **Auth & session:** `autoLogin`, `autoSelectProject`, `checkForUpdates`, `verboseOutput`*
- **Test run:** `showElectronBrowser`, `openTestResultsAfterRun`, `autoPublishLocalResults`, `autoDetectChanges`
- **Suggestions & PR:** `suggestRelatedUseCases`, `suggestRelatedTestCases`, `postPRVisualWalkthrough`
- **Default mode:** `defaultExecutionMode` (uses `local` / `remote` / `ask`)

\* `verboseOutput` has no gate file — UX-only knob, never gated.

## Resolution

`SessionStart` injects a `Muggle Preferences` line (`key=value` pairs) from
`~/.muggle-ai/preferences.json` (global) overlaid by
`<repo>/.muggle-ai/preferences.json` (project). Absent → treat as `ask`.

## Gate behavior

- `always` → take the pro-action, then print silent footer.
- `never` → take the skip-action, then print silent footer.
- `ask` (or absent) → run Picker 1 (per-key file) → Picker 2 (below).

`defaultExecutionMode` uses `local`/`remote` instead of `always`/`never`.

## Silent footer (whenever pickers are skipped)

The user must always be told **what happened**, **why it was silent**, and
**how to change it**. Two lines:

```
✓ <silent action from per-key file>
  (Skipped the prompt — `<key>` is set to `<value>`. Change: `/muggle-preferences <key>`.)
```

Concrete example (gate `autoLogin = always`):

```
✓ Continuing as foo@bar.com
  (Skipped the prompt — `autoLogin` is set to `always`. Change: `/muggle-preferences autoLogin`.)
```

## Picker 2 — shared template

Header `Remember this choice?`. Question: `"Always <restate Picker 1 choice in
plain language> from now on, without asking?"`. Never put the raw key or
`=` in the user-visible text.

- `Yes, always` (sub: `You can change this later in muggle preferences.`) → `muggle-local-preferences-set` with the value Picker 1 mapped to, `scope: "global"`.
- `Just this once` (sub: `I'll ask again next time.`) → don't save.

A few keys override this template (their per-key file says how).

**Saved value MUST match the Picker 1 choice.** Saving the opposite of
what the user picked is a bug.

## `/muggle-preferences <key>` (re-prompt)

Run Picker 1 only, save immediately, skip Picker 2.
