---
name: muggle-init
model: haiku
description: "Run the Muggle onboarding walkthrough in the agent: saves first-time preferences and offers the CI check. Use on muggle init. To change one saved setting, use muggle-preferences."
---

# Muggle Init

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-init"`.

> Running outside Claude Code (in Codex, for one)? Read [`../_shared/host-tool-equivalents.md`](../_shared/host-tool-equivalents.md) first — it maps the tools and paths this skill names to your host's.

`muggle init` prompts in a terminal, which an agent cannot answer. This skill renders the same walkthrough with `--json` and saves the answers with `--apply`.

## Steps

1. Run `muggle init --json` and show `primerHeadline` and `primerBullets`.
2. Ask for the blanket choice with `AskUserQuestion`, one option per `blanketOptions` entry, using its `label` and `description`.
3. On `customize`, ask each group in order:
   - `toggle` — multi-select of its `entries`, pre-selecting `isSelectedByDefault`. Collect the selected keys into `selectedToggleKeys`.
   - `choice` — single-select of its `options`, the `isDefault` one first. Record `choices[<key>] = <value>`.
4. Write the answers to a temp file: `{ "blanket": "<choice>", "selectedToggleKeys": [...], "choices": { ... } }`. The last two fields only apply to `customize`.
5. Run `muggle init --apply <file>`, then delete the file. A non-zero exit prints why; report it and stop.
6. When the output says the repository has no Muggle E2E check in CI yet, offer the `muggle-ci-install` skill. `--apply` never asks this itself.
7. Unless the blanket was `skip`, run `muggle llm-source --json` and ask its `prompt` with one option per `options` entry, `current.source` first. Apply it with `muggle llm-source --use <source>`; `local-model` also needs `--base-url` and `--model`. An Anthropic key is only accepted at a hidden terminal prompt, so never collect it in chat: for `anthropic-api-key`, tell the user to run `muggle llm-source --use anthropic-api-key` in their own terminal.
8. Report what was saved.
