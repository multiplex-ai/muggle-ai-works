---
name: muggle
description: Muggle AI command router and menu. Use when user types "muggle" or asks for available Muggle commands.
---

# Muggle

Use this as the top-level Muggle command router.

## Menu

When user asks for "muggle" with no specific subcommand, use `AskQuestion` to present the command set as clickable options:

- "Test my changes — change-driven E2E acceptance testing (local or remote)" → `muggle-test`
- "Test a feature on localhost — run a single E2E test locally" → `muggle-test-feature-local`
- "Autonomous dev pipeline — requirements to PR" → `muggle-do`
- "Health check — verify installation status" → `muggle-status`
- "Repair — fix broken installation" → `muggle-repair`
- "Upgrade — update to latest version" → `muggle-upgrade`

## Routing

If the user intent clearly matches one command, route directly — no menu needed:

- status/health/check → `muggle-status`
- repair/fix/install broken → `muggle-repair`
- upgrade/update latest → `muggle-upgrade`
- test my changes/acceptance test my work/test before push/post E2E acceptance results to PR/test on staging/test on preview → `muggle-test`
- test localhost/validate single feature → `muggle-test-feature-local`
- build/implement from request → `muggle-do`

If intent is ambiguous, use `AskQuestion` with the most likely options rather than asking the user to type a clarification.
