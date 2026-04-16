---
name: muggle
description: Muggle AI command router and menu. Use when user types "muggle" or asks for available Muggle commands.
---

# Muggle

Use this as the top-level Muggle command router.

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
