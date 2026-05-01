# Preference Gates — Contract

One file per key in this directory — `ls preference-gates/*.md` is the
authoritative key list. Skills load this contract + only the gates they
actually fire.

Default allowed values: `always` / `never` / `ask`. Per-key overrides
are noted in their own file (currently only `defaultExecutionMode`,
which uses `local` / `remote` / `ask`).

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
