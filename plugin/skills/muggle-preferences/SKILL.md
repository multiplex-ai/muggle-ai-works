---
name: muggle-preferences
model: haiku
description: >-
  View, set, or reset Muggle AI preferences that control testing behavior.
  Use when user asks to see preferences, change a setting, configure Muggle Test
  defaults, or manage muggle config. Triggers on: 'muggle preferences',
  'show muggle settings', 'change muggle preference', 'set autoLogin to
  always', 'muggle config', 'reset muggle preferences', 'show my muggle
  settings', 'configure muggle', 'muggle setup'.
---

# Muggle Test Preferences

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-preferences"`.

Pick the operation, then read its op file for the procedure.

| Intent | Op file |
|---|---|
| `/muggle-preferences <key>` or "change my `<key>` preference" | `ops/change-one.md` |
| User names key + value (e.g. "set autoLogin to always") | `ops/set.md` |
| "show preferences" / no args | `ops/list.md` |
| "configure muggle" / "muggle setup" / change without naming a key | `ops/configure.md` |
| "reset preferences" | `ops/reset.md` |
| Session context says first-run setup has not been run | `ops/onboard.md` |

## Shared context (all ops)

- **Current values**: session-context line `Muggle Test Preferences key=value …`, already resolved against the shipped defaults in `${CLAUDE_PLUGIN_ROOT}/config/preference-defaults.json`.
- **Per-key files**: `preference-gates/<key>.md`. Key list = `ls preference-gates/*.md` minus `README.md`.
- **Allowed values**: `always`/`never`/`ask`, except `defaultExecutionMode` (`local`/`remote`/`ask`), `autoE2ETest` (`always`/`ask`), and `watcherLifetime` (`1d`/`7d`/`never`).
- **Scope**: preferences are user-level. Every write lands in `~/.muggle-ai/preferences.json` and applies to every repo. If the user asks for a per-project setting, say it isn't supported and confirm before setting it everywhere.
