---
name: muggle
description: Muggle AI command router and menu. Use when user types "muggle" or asks for available Muggle commands.
---

# Muggle

Use this as the top-level Muggle command router.

## Preferences

User preferences are injected by the SessionStart hook into a `Muggle Preferences` line in session context (key=value pairs). Resolution: defaults → `~/.muggle-ai/preferences.json` (global) → `<repo>/.muggle-ai/preferences.json` (project). Treat absent prefs as `ask`.

This router skill itself does not gate any decision on a preference — it just routes user intent to a downstream skill. Each downstream skill consults its own preferences. For example, `checkForUpdates` is consulted by `muggle-status` (Check 4), not here.

If the user types "muggle" with no subcommand and you want to surface a contextual hint about the update-check pref, defer to `muggle-status` rather than reimplementing the gate in this router.

## Menu

When user asks for "muggle" with no specific subcommand, use `AskQuestion` to present these four options:

- "Test a feature — run E2E acceptance tests locally or remotely" → `muggle-test-feature-local` (local) or `muggle-test` (remote/change-driven)
- "Build something — implement a feature with E2E acceptance tests and a visual PR" → `muggle-do`
- "Health check — verify installation and fix issues" → `muggle-status` (then `muggle-repair` if issues found)
- "Upgrade — update to latest version" → `muggle-upgrade`

## Routing

If the user intent clearly matches one command, route directly — no menu needed:

- status/health/check → `muggle-status`
- repair/fix/install broken → `muggle-repair`
- upgrade/update latest → `muggle-upgrade`
- test my changes/acceptance test my work/test before push/post E2E acceptance results to PR/test on staging/test on preview → `muggle-test`
- test localhost/validate single feature/test a feature → `muggle-test-feature-local`
- build/implement from request/end-to-end → `muggle-do`
- post results to PR/attach walkthrough/visual evidence on PR → `muggle-pr-visual-walkthrough`

If intent is ambiguous, use `AskQuestion` with the most likely options rather than asking the user to type a clarification.
