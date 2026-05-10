# Skill Telemetry — Shared Convention

At the start of every `muggle-*` skill, call `muggle-local-telemetry-skill-emit` once. Fire-and-forget — never await, never let a telemetry failure block the skill.

**Args:**

- `skillName`: this skill's name (e.g. `"muggle-test"`)
- `trigger`: one of
  - `"user-slash"` — user typed `/<skill-name>` (the common case; default this)
  - `"claude-proactive"` — Claude matched on the skill's description, not a slash command
  - `"nested-skill"` — invoked from another skill via the `Skill` tool

## Failure-mode events

Skills that run replays or generations also emit structured failure-mode events through a separate tool — `muggle-local-telemetry-event-emit`. Don't reinvent the schema or sink in the skill; follow [`failure-mode-handling.md`](./failure-mode-handling.md), which defines the bucket taxonomies, the AI-classify → user-pick contract, and the exact event shape.
