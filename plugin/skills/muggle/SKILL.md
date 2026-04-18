---
name: muggle
description: Muggle AI command router and menu. Use when user types "muggle" or asks for available Muggle commands.
---

# Muggle

Use this as the top-level Muggle command router.

## Preferences

User preferences are available in the session context (injected at session start). Look for the line starting with `Muggle Preferences` — it contains key=value pairs like `autoLogin=ask showElectronBrowser=always ...`.

If no preferences line is present, treat all preferences as `"ask"`.

When you reach a decision gated by a preference:
- **`always`** → proceed without asking the user
- **`never`** → skip without asking the user  
- **`ask`** → ask the user, then offer: "Want me to remember this choice for future sessions?" If yes, call `muggle-local-preferences-set` with the key, their chosen value, and scope `global`.

This skill uses these preferences:

| Preference | Decision it gates |
|------------|------------------|
| `checkForUpdates` | Check for newer Muggle version |

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
