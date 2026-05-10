---
name: muggle-feedback
description: Capture feedback on a generated Muggle Test action script — either step-level or whole-script — and submit it so the system can analyze it and regenerate affected scripts. Use when the user has just run a Muggle Test (local or remote) and wants to flag what went wrong, when they paste a Muggle dashboard URL with a test script or run, or when they want to view or delete previously submitted feedback. Triggers on: '/muggle-feedback', 'give feedback on this run', 'the test was wrong', 'step N didn't work', 'the script clicked the wrong button', 'flag this run', 'the summary is wrong', 'show my feedback', 'list feedback', 'delete that feedback'. Skill auto-detects the run context from a recent local run, a remote run, or a Muggle dashboard URL in the prompt.
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

- Use `AskUserQuestion` for every selection (project, test case, run, target type, confirm). Never ask the user to "reply with a number" in plain text.
- Convert step numbers between 1-based (rendered to user) and 0-based (wire format) at the boundary. Never expose 0-based indices to the user.
- One MCP submit/delete call per feedback piece — never batch into a single call.
- Surface the `feedbackAnalysisWorkflowRuntimeId` returned by submit so the user knows regeneration is running. Do not poll it from this skill.
