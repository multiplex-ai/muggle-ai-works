---
name: muggle-preferences
model: haiku
description: "View, set, or reset Muggle AI preferences that control testing behavior. Use when the user asks to see their muggle settings, what a setting does, which setting controls a behavior (stop the login prompt, skip auto-rebase), where the settings live, or to change, configure, or reset one. Route these through this skill rather than answering from the preferences line in session context — it explains what each key gates, its allowed values, and writes changes to the right file. Triggers on: 'muggle preferences', 'what are my muggle settings', 'list every muggle preference', 'set autoLogin to always', 'turn autoRebase off', 'muggle config', 'reset muggle preferences', 'configure muggle', 'muggle setup'."
---

# Muggle Test Preferences

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-preferences"`.

> Running outside Claude Code (in Codex, for one)? Read [`../_shared/host-tool-equivalents.md`](../_shared/host-tool-equivalents.md) first — it maps the tools and paths this skill names to your host's.

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
- **Allowed values**: `always`/`never`/`ask`, except `defaultExecutionMode` (`local`/`remote`/`ask`), `autoE2ETest` (`always`/`ask`), `watcherLifetime` (`1d`/`7d`/`never`), and `maxCatchUpRebases` (a positive integer, or `never`).
- **Scope**: preferences are user-level. Every write lands in `~/.muggle-ai/preferences.json` and applies to every repo. If the user asks for a per-project setting, say it isn't supported and confirm before setting it everywhere.
