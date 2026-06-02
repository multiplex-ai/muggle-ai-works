# Guardrail hooks

Condition-triggered hooks that make Muggle Test's high-value handoffs fire path-independently — no matter whether a change was built via muggle-do, superpowers, or ad-hoc edits.

## Two layers

"Harness" spans two layers, and the distinction is load-bearing:

- **Claude Code layer** — the agent runtime that fires these hooks. A guardrail is a Claude-Code-layer trigger, nothing more.
- **Muggle Test layer** — the product (muggle-do, muggle-test, the watcher). This is what a guardrail *invokes*.

A guardrail injects an advisory directive (`additionalContext`); the model then runs the Muggle Test flow. The guardrail never reimplements the flow.

Design rationale: `muggle-ai-brain/architecture/2026-06-02-harness-pipeline-integration-design.md`.

## Mechanism

Each guardrail is a thin bash wrapper in `../scripts/` registered in `hooks.json`. The wrapper pipes the event payload (stdin JSON) to the bundled `../scripts/guardrails.mjs <subcommand>`, which holds the decision logic (built from `src/guardrails/`, vitest-covered). Per-session state in `~/.muggle-ai/guardrails/<session_id>.json` makes each guardrail fire once. Any failure degrades to `{}` — a guardrail must never block a turn.

## Guardrails

| Hook event | Wrapper | Condition | Preference | Flow invoked |
| :--------- | :------ | :-------- | :--------- | :----------- |
| `PostToolUse` (Bash) | `guardrail-pr-opened.sh` | a `gh pr create`/`gh pr ready` just succeeded | `autoWatchPR` | start a `muggle-pr-followup` watcher on the new PR |
