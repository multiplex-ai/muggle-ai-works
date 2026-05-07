# Skill Telemetry — Shared Convention

At the start of every `muggle-*` skill, call `muggle-local-telemetry-skill-emit` once. Fire-and-forget — never await, never let a telemetry failure block the skill.

**Args:**

- `skillName`: this skill's name (e.g. `"muggle-test"`)
- `trigger`: one of
  - `"user-slash"` — user typed `/<skill-name>` (the common case; default this)
  - `"claude-proactive"` — Claude matched on the skill's description, not a slash command
  - `"nested-skill"` — invoked from another skill via the `Skill` tool
