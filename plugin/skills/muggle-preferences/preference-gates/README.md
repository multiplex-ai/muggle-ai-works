# Preference Gates — Contract

One file per gate in this directory. Skills load this contract + only the
gates they actually fire.

## Keys (single source of truth)

12 total. The `muggle-preferences` skill renders its List, Configure, and
Set operations from this index — do **not** duplicate this table elsewhere.

| Key | Allowed values | Category | Description |
|-----|----------------|----------|-------------|
| `autoLogin` | always/never/ask | Auth & session | Reuse saved credentials without prompting |
| `autoSelectProject` | always/never/ask | Auth & session | Reuse last-used project for this repo |
| `checkForUpdates` | always/never/ask | Auth & session | Check for newer Muggle version at session start |
| `verboseOutput` | always/never/ask | Auth & session | Show detailed progress logs during execution |
| `showElectronBrowser` | always/never/ask | Test run | Show browser window during local tests |
| `openTestResultsAfterRun` | always/never/ask | Test run | Open results page on dashboard after a local run |
| `autoPublishLocalResults` | always/never/ask | Test run | Upload local results to Muggle cloud |
| `autoDetectChanges` | always/never/ask | Test run | Scan local git changes and map to affected test cases |
| `suggestRelatedUseCases` | always/never/ask | Suggestions & PR | Suggest related use cases after creating/running one |
| `suggestRelatedTestCases` | always/never/ask | Suggestions & PR | Suggest related test cases after creating/running one |
| `postPRVisualWalkthrough` | always/never/ask | Suggestions & PR | Post visual walkthrough with screenshots to PR |
| `defaultExecutionMode` | local/remote/ask | Default mode | Default to local or remote test execution |

`verboseOutput` is a UX-only knob — no gate file for it; everything else
has `<key>.md` in this directory with its Picker 1 spec.

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

```
✓ <silent action from per-key file>. Change with `/muggle-preferences <key>`.
```

## Picker 2 — shared template

Header `Save this choice?`. Question: `"Always <restate Picker 1 choice in
plain language> from now on, without asking?"`. Never put the raw key or
`=` in the user-visible text.

- `Yes, always` (sub: `You can change this later in muggle preferences.`) → `muggle-local-preferences-set` with the value Picker 1 mapped to, `scope: "global"`.
- `Just this once` (sub: `I'll ask again next time.`) → don't save.

A few keys override this template (their per-key file says how).

**Saved value MUST match the Picker 1 choice.** Saving the opposite of
what the user picked is a bug.

## `/muggle-preferences <key>` (re-prompt)

Run Picker 1 only, save immediately, skip Picker 2.
