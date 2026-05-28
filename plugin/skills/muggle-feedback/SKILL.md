---
name: muggle-feedback
description: Use when the user wants to flag that a generated Muggle Test action script — or one specific step in it — did the wrong thing, and have it captured so Muggle can analyze and regenerate affected scripts. Covers any report that a script or step is wrong, broken, or misbehaving (clicked the wrong element, bad summary, "step N didn't work", "broken at the submit step"), whether the user just ran a test locally or remotely or pastes a Muggle dashboard run/script URL and points at what failed. Also use to view, list, or delete previously submitted feedback. Triggers on '/muggle-feedback', 'give feedback on this run', 'the test was wrong', 'flag this run', 'show/list/delete my feedback'. Auto-detects run context from a recent local run, a remote run, or a dashboard URL in the prompt.
---

# Muggle Test Feedback

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-feedback"`.

Capture user feedback on what a generated Muggle Test action script did wrong. The server uses each feedback row to find similar test cases via LLM and regenerate their scripts in the background.

## Routing

Pick the operation, then read its op file for the procedure.

| Intent | Op file |
|---|---|
| "give feedback on this run" / "the test was wrong" / "step N didn't work" / a Muggle dashboard URL in the prompt / chained from another skill | [`ops/submit.md`](ops/submit.md) |
| "show my feedback" / "list feedback for this project" / "what feedback have I filed" | [`ops/list.md`](ops/list.md) |
| "delete that feedback" / "remove feedback for X" | [`ops/delete.md`](ops/delete.md) |

If intent is ambiguous, use `AskUserQuestion` once with options **Submit / List / Delete** — never ask the user to type a clarification in plain text.

## Constraints (all ops)

- **Feedback attaches to a cloud action-script id.** A local run that has not yet been uploaded to the cloud has no such id. Submit must upload the run first if needed.
- **Feedback target is one of two shapes:**
  - **Whole script** — `target.targetType = "actionScript"`, `target.targetId = <actionScriptId>`.
  - **One specific step** — `target.targetType = "step"`, `target.targetId = "<actionScriptId>:<stepIndex>"` where `stepIndex` is **0-based** on the wire even though steps are shown to the user 1-based.
- **Project scope.** All ops scope to the user's last-used project (`muggle-local-last-project-get`). If unset, ask once and persist via `muggle-local-last-project-set` so subsequent ops in this session reuse it.
- **`feedbackText` must be non-empty.** Re-prompt the user if they leave it blank.

## Non-negotiables (all ops)

- Use `AskUserQuestion` for every selection (project, test case, run, target type, which step(s), confirm). Step selection must be a clickable picker built from the rendered steps (see [`ops/submit.md`](ops/submit.md) §3b) — never ask the user to type a number.
- Always render the run's steps and summary (§2) **before** collecting feedback — users can only point at what they can see.
- Convert step numbers between 1-based (rendered to user) and 0-based (wire format) at the boundary. Never expose 0-based indices to the user.
- One MCP submit/delete call per feedback piece — never batch into a single call.
- Surface the `feedbackAnalysisWorkflowRuntimeId` returned by submit so the user knows regeneration is running. Do not poll it from this skill.
