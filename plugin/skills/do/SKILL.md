---
name: do
description: Quality-guaranteed development workflow that takes a task through requirements, coding, testing, QA with real-browser validation, and PR creation. Use this skill when the user wants to implement a feature or fix with built-in QA — especially when they mention 'build and test', 'implement with QA', 'full dev cycle', or want confidence that their changes work end-to-end before opening a PR.
disable-model-invocation: true
---

# Muggle Do

Muggle Do is the top-level command for the Muggle AI development workflow.

It runs the autonomous dev cycle: requirements -> impact analysis -> validate code -> coding -> unit tests -> QA -> open PRs.

For maintenance tasks, use the dedicated skills: `/muggle:status`, `/muggle:repair`, `/muggle:upgrade`.

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

Use the supporting files in this directory as stage-specific instructions:

- [requirements.md](requirements.md)
- [impact-analysis.md](impact-analysis.md)
- [validate-code.md](validate-code.md)
- [unit-tests.md](unit-tests.md)
- [qa.md](qa.md)
- [open-prs.md](open-prs.md)

## Guardrails

- Do not skip unit tests before QA.
- Do not skip QA due to missing scripts; generate when needed.
- If the same stage fails 3 times in a row, escalate with details.
- If total iterations reach 3 and QA still fails, continue to PR creation with `[QA FAILING]`.
