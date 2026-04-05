---
name: muggle-do
description: Unified Muggle AI workflow entry point. Use when user types muggle do or asks for autonomous implementation to PR.
disable-model-invocation: true
---

# Muggle Do

Muggle Do is the command for the Muggle AI development workflow.

It runs a battle-tested autonomous dev cycle: requirements -> impact analysis -> validate code -> coding -> unit tests -> E2E acceptance tests -> open PRs.

For maintenance tasks, use the dedicated skills:

- `/muggle:muggle-status`
- `/muggle:muggle-repair`
- `/muggle:muggle-upgrade`

## Input routing

Treat `$ARGUMENTS` as the user command:

- Empty / `help` / `menu` / `?` -> show menu and session selector.
- Anything else -> treat as a new task description and start/resume a dev-cycle session.

## Session model

Use `.muggle-do/sessions/<slug>/` with these files:

- `state.md`
- `requirements.md`
- `iterations/<NNN>.md`
- `result.md`

On each stage transition, update `state.md` and append stage output to the active iteration file.

## Dev cycle agents

Use the supporting files in the `../do/` directory as stage-specific instructions:

- [requirements.md](../do/requirements.md)
- [impact-analysis.md](../do/impact-analysis.md)
- [validate-code.md](../do/validate-code.md)
- [unit-tests.md](../do/unit-tests.md)
- [e2e-acceptance.md](../do/e2e-acceptance.md)
- [open-prs.md](../do/open-prs.md)

## Guardrails

- Do not skip unit tests before E2E acceptance tests.
- Do not skip E2E acceptance tests due to missing scripts; generate when needed.
- If the same stage fails 3 times in a row, escalate with details.
- If total iterations reach 3 and E2E acceptance tests still fail, continue to PR creation with `[E2E FAILING]`.
