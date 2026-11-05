# Submit feedback

Resolve the action script being commented on, render it for review, collect feedback against one or more steps and/or the whole script, submit each piece as its own server-side row, then regenerate on this machine whatever only it can regenerate.

## 1. Resolve the action script (the "anchor")

Pick the first applicable path. Stop at the first that yields an `actionScriptId`.

### 1a. Dashboard URL in user's prompt

A Muggle dashboard URL contains `/muggleTestV0/dashboard/projects/<projectId>/` on any lane's host — `www.muggle-ai.com` (production), `staging.muggle-ai.com` (staging), or `localhost:3999` (local). Scan the user's recent message for a URL with that path; match the path, never the host.

- Extract any UUID-shaped path segments. If `/projects/<uuid>` is present, capture as `projectId`. If `/test-scripts/<uuid>` is present, capture as `testScriptId`.
- If the URL carries an `actionScriptId` query parameter (a run's `viewUrl` does), that is the anchor. Done — proceed to step 2.
- If a `testScriptId` was captured: call `muggle-remote-test-script-get` to get the script and read `actionScriptId` off it. Done — proceed to step 2.
- If only a `projectId` was captured: use it as the project for path 1c and continue to picker.
- If parsing yields nothing actionable: fall through to 1b.

### 1b. Recent local run (chained or just-finished)

If this skill was invoked by another skill (`muggle-test`, `muggle-test-feature-local`) the caller MUST pass the just-finished `runId` as context. If you have a `runId`:

1. `muggle-local-run-result-get` with the `runId`.
2. The result includes the test case context. The studio publishes every local run during execution, so the run result carries the cloud `cloudActionScriptId` — use it directly as the `actionScriptId`.
3. **Legacy fallback** — if `cloudActionScriptId` is absent (a run from an older Electron build that didn't publish), upload it first via `muggle-remote-local-run-upload` (passing the `runId`'s test case context and `actionScript` payload). Use the returned cloud `actionScriptId`.

If no `runId` was passed but the user is plausibly continuing from a recent test:

1. `muggle-local-list-sessions` and pick sessions completed in the last 10 minutes for the current project.
2. If exactly one fresh session exists, offer it as the default via `AskUserQuestion` ("Feedback on the run from <X> minutes ago?" with **Yes / Pick a different run**).
3. If multiple, present the top 3 via `AskUserQuestion` (most recent first).
4. Once picked, resolve `cloudActionScriptId` from the run result (legacy upload fallback above).

If neither chained nor recent fits, fall through to 1c.

### 1c. Picker (project → test case → run)

1. **Project.** Read `muggle-local-last-project-get`. If set, use it. Else `muggle-remote-project-list` with `AskUserQuestion` (top 5 by recency, plus "Show full list"). Persist the pick with `muggle-local-last-project-set`.
2. **Test case.** `muggle-remote-test-case-list` with `projectId`, then `AskUserQuestion`. Top 5 by recency plus "Show full list". Rank by relevance if the user mentioned anything specific.
3. **Run / script.** `muggle-remote-test-script-list` with `testCaseId`. Show via `AskUserQuestion` with: name + status + updatedAt. Top 5 by recency.
4. `muggle-remote-test-script-get` on the picked one → note `actionScriptId`.

## 2. Render the script for review

Always render before asking for feedback — the user must see the steps to reference them by index.

`muggle-remote-action-script-get` with the resolved `actionScriptId`.

For a local run you already hold the `runId` for, `muggle-local-run-steps-get` returns the same steps with each frame's path already resolved — prefer it over walking the session directory. It numbers steps from 0; this skill's feedback anchors are **1-based**, so renumber when printing rather than passing its text through.

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

Always pass `projectId` and `feedbackText`. Capture each response — note `feedback.id`, `feedbackAnalysisWorkflowRuntimeId` (may be undefined) and `localRegenerationTestCaseIds` (test cases only this machine can regenerate; absent means none).

If a single create call fails, log the error, continue with the rest, and report the failure at the end. Do not abort the batch.

## 5. Wait for the analysis

The create response names only the feedback target. When the analysis ends, the entry's `outcome` also names similar test cases and what regenerated in the cloud.

Skip this step when no response carries a `feedbackAnalysisWorkflowRuntimeId`. Otherwise:

1. `muggle-remote-user-feedback-list` with `projectId` and `actionScriptId`. Find each submitted `feedback.id` in the response.
2. While any of them has `outcome.state` `analyzing`, wait 15 seconds (`node -e "setTimeout(() => {}, 15000)"`) and list again, at most 12 times.

Build two lists of unique test case ids:

- **Cloud** — every `outcome.regeneratedTestCaseIds`. Already started; this skill does nothing more for them.
- **Local** — every create response's `localRegenerationTestCaseIds` and every `outcome.localRegenerationTestCaseIds`, the feedback target first.

An entry still `analyzing` after the last check keeps only what its create response named. `outcome.state` `failed` means the analysis stopped, so similar test cases were not checked; what the create response named still stands.

## 6. Regenerate locally

Skip when **Local** is empty. Never start a cloud generation for a test case on this list: the cloud may not reach its site.

When this skill was invoked from a failed run's **Give feedback & rerun** option, the caller regenerates that run's test case as soon as this skill returns. Drop it from **Local**, so it is not regenerated twice, and run the rest.

Resolve once:

- `cwd` — the PR-branch worktree if one exists, else the repo root, else the current directory.
- `showUi` — gate `showElectronBrowser` (per `preference-gates/README.md`): `always` → omit `showUi`; `never` → pass `showUi: false`; `ask` → ask via `AskUserQuestion`, then map the answer the same way.

Then, one test case at a time, in **Local** order:

1. **`localUrl`** — the first of these that yields a URL:
   1. `muggle-remote-test-script-list` with `projectId`, `testCaseId` and `runEnvironmentType: "local"` → the newest script's `url`.
   2. For the feedback target, the `url` of the action script rendered in §2.
   3. `muggle-local-last-host-get`.
   4. `AskUserQuestion`, offering the test case's `url`, with **Skip this test case** as the last option.
2. **Reachability** — probe `localUrl` once, as [`dev-server-readiness.md`](../../_shared/dev-server-readiness.md) Stage 1 does but with a single attempt. No response means this test case cannot run.
3. **Run** — the `regen` mode of [`run.md`](../../_shared/dev-loop/run.md), Records included, with `timeoutMs: 900000`. Leave the test case as it is and pass no `mutations`: every generation loads the project's saved feedback itself, which is how this feedback reaches the run.
4. **Result** — read it per [`failures.md`](../../_shared/dev-loop/failures.md). A passing run: keep its `runId` and `viewUrl`. A non-passing run goes through [`debug-failed-run.md`](../../_shared/debug-failed-run.md) before the next test case. A `Run refused` result launched nothing: follow `run.md`'s rule for it once; a second refusal means this test case cannot run.

A test case that cannot run goes on a **Not run** list with its reason; move on to the next one.

## 7. Report

Print one line per submitted feedback in this shape:

```
✓ feedback <id> — <target description> [analysis runtime: <id>]
```

Read the titles with `muggle-remote-test-case-get`, then print each line below that applies, and only those:

- **Cloud** not empty → "Regenerating in the cloud: <titles>. Re-run them later to use the updated scripts."
- A passing local run → "Regenerated locally: <title> — <viewUrl>"
- A non-passing local run → "Local regeneration failed: <title> — run <runId>: <one-line diagnosis>"
- A test case dropped for the caller's rerun → "Left for the rerun: <title>"
- **Not run** → "Not regenerated: <title> — <reason>. Your feedback is saved and reaches the next generation. To regenerate it now, <start the site at `localUrl`, or connect to the network that reaches it>, then run `/muggle-test-feature-local`, pick this test case and choose **Generate new script**."
- An entry still `analyzing` → "Still analyzing, so similar test cases may follow. Check later with `/muggle-feedback`."
- An entry `failed` → "The analysis failed, so similar test cases were not checked."
- **Cloud** and **Local** both empty, and no entry `analyzing` or `failed` → "No test case needed regenerating. Your feedback is kept as guidance for future generations."

If any pieces failed, list them under a `Failed:` header with the error.

## Non-negotiables

- Always render the script (step 2) before collecting feedback.
- One create call per feedback piece — never concatenate paragraphs across targets.
- Convert step numbers from 1-based (UI) to 0-based (wire) at submit time.
- If a legacy local run carries no `cloudActionScriptId`, do the upload silently before submit; do not ask for permission for the upload itself.
- Never start a cloud generation for a test case on the **Local** list.
- Run local regenerations one at a time.
- Never report a regeneration that did not start.
