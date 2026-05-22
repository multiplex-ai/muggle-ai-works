# Submit feedback

Resolve the action script being commented on, render it for review, collect feedback against one or more steps and/or the whole script, then submit each piece as its own server-side row.

## 1. Resolve the action script (the "anchor")

Pick the first applicable path. Stop at the first that yields an `actionScriptId`.

### 1a. Dashboard URL in user's prompt

A Muggle dashboard URL looks like `https://www.muggle-ai.com/muggleTestV0/dashboard/projects/<projectId>/...`. Scan the user's recent message for any `https://www.muggle-ai.com/...` URL.

- Extract any UUID-shaped path segments. If `/projects/<uuid>` is present, capture as `projectId`. If `/test-scripts/<uuid>` is present, capture as `testScriptId`.
- If a `testScriptId` was captured: call `muggle-remote-test-script-get` to get the script and read `actionScriptId` off it. Done — proceed to step 2.
- If only a `projectId` was captured: use it as the project for path 1c and continue to picker.
- If parsing yields nothing actionable: fall through to 1b.

### 1b. Recent local run (chained or just-finished)

If this skill was invoked by another skill (`muggle-test`, `muggle-test-feature-local`) the caller MUST pass the just-finished `runId` as context. If you have a `runId`:

1. `muggle-local-run-result-get` with the `runId`.
2. The result includes the test case context. If the run was already published (`muggle-local-publish-test-script` was called), the resulting `testScriptId` gives you the cloud `actionScriptId` via `muggle-remote-test-script-get`.
3. **If the run was NOT published**, upload it first via `muggle-remote-local-run-upload` (passing the `runId`'s test case context and `actionScript` payload). Use the returned cloud `actionScriptId`.

If no `runId` was passed but the user is plausibly continuing from a recent test:

1. `muggle-local-list-sessions` and pick sessions completed in the last 10 minutes for the current project.
2. If exactly one fresh session exists, offer it as the default via `AskUserQuestion` ("Feedback on the run from <X> minutes ago?" with **Yes / Pick a different run**).
3. If multiple, present the top 3 via `AskUserQuestion` (most recent first).
4. Once picked, follow the publish-or-upload path above.

If neither chained nor recent fits, fall through to 1c.

### 1c. Picker (project → test case → run)

1. **Project.** Read `muggle-local-last-project-get`. If set, use it. Else `muggle-remote-project-list` with `AskUserQuestion` (top 5 by recency, plus "Show full list"). Persist the pick with `muggle-local-last-project-set`.
2. **Test case.** `muggle-remote-test-case-list` with `projectId`, then `AskUserQuestion`. Top 5 by recency plus "Show full list". Rank by relevance if the user mentioned anything specific.
3. **Run / script.** `muggle-remote-test-script-list` with `testCaseId`. Show via `AskUserQuestion` with: name + status + updatedAt. Top 5 by recency.
4. `muggle-remote-test-script-get` on the picked one → note `actionScriptId`.

## 2. Render the script for review

Always render before asking for feedback — the user must see the steps to reference them by index.

`muggle-remote-action-script-get` with the resolved `actionScriptId`.

Print:

- **Header** — project name, test case title, script name, status, run url (if available). For remote, include the dashboard link.
- **Steps** — numbered list, **1-based**, in order:
  - `Step <n>: <action label> on <element text or id> — <briefExplanation>`
  - If `screenshotPath` is present (local) or `screenshotUrl` (remote), append `[screenshot: <path>]` so the user can open it manually.
- **Summary** — print `summary` from the action script if present, else "No summary recorded".

## 3. Collect feedback (batch)

### 3a. Pick the scope (entity type)

Use `AskUserQuestion` to scope which targets:

> "Where is the problem?"
> - One specific step
> - Multiple steps
> - The whole script's outcome / summary
> - Multiple steps **and** the whole outcome

### 3b. Pick the step(s) — clickable picker

When 3a includes any step-level scope, present the rendered steps as a **clickable `AskUserQuestion` picker** — never as a typed number.

- **Option format** — Label: `Step <n>: <action label> on <element text or id>` (≤80 chars). Description: the step's `briefExplanation` (≤120 chars).
- **Multi-select** — `multiSelect: true` for "Multiple steps" or "Multiple steps and the whole outcome"; `multiSelect: false` for "One specific step".
- **Long scripts (>10 steps)** — rank by keyword overlap with the user's prompt (label or briefExplanation); fall back to the first 10 if no match. Append **"Show all steps"** as a final option that re-asks with the full list — never silently truncate.

For each selected step, prompt in plain text:

> "What should step `<n>` have done instead?"

For the whole-script scope, prompt:

> "What's wrong with the overall outcome?"

Validate each paragraph is non-empty (re-prompt if blank). Build an in-memory list of feedback pieces:

```
[
  { kind: "step", stepNumber: 3, text: "..." },
  { kind: "step", stepNumber: 7, text: "..." },
  { kind: "actionScript",            text: "..." },
]
```

Before submitting, re-confirm the full set with the user via `AskUserQuestion`:

> "Submit these <N> feedback entries?" — **Submit / Edit / Cancel**.

## 4. Submit

For each piece, call `muggle-remote-user-feedback-create` once. Map fields:

| Piece kind | `target.targetType` | `target.targetId` |
|---|---|---|
| Step `n` (1-based) | `"step"` | `` `${actionScriptId}:${n - 1}` `` (convert to 0-based) |
| Whole script | `"actionScript"` | `actionScriptId` |

Always pass `projectId` and `feedbackText`. Capture each response — note `feedback.id` and `feedbackAnalysisWorkflowRuntimeId` (may be undefined).

If a single create call fails, log the error, continue with the rest, and report the failure at the end. Do not abort the batch.

## 5. Report

Print one line per submitted feedback in this shape:

```
✓ feedback <id> — <target description> [analysis runtime: <id>]
```

End with a one-line note:

> "Regeneration runs in the background. Re-run this test case later to use the updated script."

If any pieces failed, list them under a `Failed:` header with the error.

## Non-negotiables

- Always render the script (step 2) before collecting feedback.
- One create call per feedback piece — never concatenate paragraphs across targets.
- Convert step numbers from 1-based (UI) to 0-based (wire) at submit time.
- If the user came from a non-uploaded local run, do the upload silently before submit; do not ask for permission for the upload itself.
