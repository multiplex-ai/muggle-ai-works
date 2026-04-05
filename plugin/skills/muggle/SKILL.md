---
name: muggle
description: Muggle AI command router and menu. Use when user types "muggle" or asks for available Muggle commands.
---

# Muggle

Use this as the top-level Muggle command router.

## Menu

When user asks for "muggle" with no specific subcommand, show this command set:

- `/muggle:muggle-do` — autonomous dev pipeline
- `/muggle:muggle-test-feature-local` — local feature E2E acceptance testing
- `/muggle:muggle-status` — health check
- `/muggle:muggle-repair` — repair broken installation
- `/muggle:muggle-upgrade` — upgrade local installation

## Routing

If the user intent clearly matches one command, route to that command behavior:

- status/health/check -> `muggle-status`
- repair/fix/install broken -> `muggle-repair`
- upgrade/update latest -> `muggle-upgrade`
- test localhost/validate feature -> `muggle-test-feature-local`
- build/implement from request -> `muggle-do`

If intent is ambiguous, ask one concise clarification question.
