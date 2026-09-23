# Onboard (first-run walkthrough)

Runs once per machine, when session context says Muggle Test first-run setup has not been run. Explains what Muggle Test is, then saves the user's preferences.

The CLI owns the questions and every mapping from an answer onto a preference value. Render what `muggle init --json` returns — never hardcode keys, labels, or defaults here, and never write `preferences.json` directly.

## Step 1 — answer the user first

If the user asked for something, acknowledge it before offering setup. Setup is an offer, not a gate. Never make them wait for it.

## Step 2 — load the walkthrough

Run `muggle init --json`. It returns:

- `primerHeadline`, `primerBullets` — what to show before asking anything
- `blanketOptions` — the dispositions, each with `choice`, `label`, `description`
- `groups` — per-group questions; `kind` is `toggle` or `choice`

## Step 3 — show the primer, then the blanket choice

Print `primerHeadline` and `primerBullets` verbatim. Then one `AskUserQuestion` whose options are `blanketOptions` in order, using each `label` and `description`. The first option is pre-selected.

Record the picked `choice` value.

## Step 4 — per-group questions

Only when the user picked `customize`. Otherwise skip to step 5.

For each entry in `groups`, in order:

- `kind: "toggle"` — one `multiSelect: true` question. `header` = the group's `header`, question text = its `prompt`, one option per entry using `key` as the label and `description` as the description. Pre-select every entry whose `isSelectedByDefault` is true. Collect the selected `key`s.
- `kind: "choice"` — one `multiSelect: false` question. `header` = the group's `header`, question text = its `prompt`, one option per entry in `options` using `label`. Pre-select the option whose `isDefault` is true. Record `key` → the picked option's `value`.

`AskUserQuestion` takes at most 4 questions per call, so split the groups across calls.

## Step 5 — apply

Write the answers to `~/.muggle-ai/temp/onboarding-answers.json`:

```json
{
  "blanket": "customize",
  "selectedToggleKeys": ["autoLogin", "autoSelectProject"],
  "choices": { "autoE2ETest": "always", "defaultExecutionMode": "local", "watcherLifetime": "7d", "maxCatchUpRebases": "20" }
}
```

`blanket` is the value from step 3. Include `selectedToggleKeys` and `choices` only when it is `customize`.

Run `muggle init --apply ~/.muggle-ai/temp/onboarding-answers.json`, then delete the file.

## Step 6 — confirm

Print what the CLI reported. On `skip`, say it will be offered again next session and move on — a declined offer retires itself after the third time.
