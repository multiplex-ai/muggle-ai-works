---
name: muggle-do
description: Unified Muggle AI workflow entry point. Use when user types muggle do or asks for autonomous implementation to PR.
disable-model-invocation: true
---

# Muggle Do

Use this as the prefixed entry point for the autonomous Muggle AI development workflow.

Run the same behavior as the legacy `do` skill:

- requirements -> impact analysis -> validate code -> coding -> unit tests -> QA -> open PRs

For maintenance tasks, route to:

- `/muggle:muggle-status`
- `/muggle:muggle-repair`
- `/muggle:muggle-upgrade`

Follow the stage instructions from `../do/`:

- [legacy workflow](../do/SKILL.md)
