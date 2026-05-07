---
name: muggle-preferences
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

## Shared context (all ops)

- **Current values**: session-context line `Muggle Test Preferences key=value …`. Default `ask`.
- **Per-key files**: `preference-gates/<key>.md`. Key list = `ls preference-gates/*.md` minus `README.md`.
- **Allowed values**: `always`/`never`/`ask` (or `local`/`remote`/`ask` for `defaultExecutionMode`).
- **Scope**: `global` default; `project` if user says "for this project" / "just this repo" (pass `cwd`).
