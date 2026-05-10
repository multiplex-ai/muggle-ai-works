# Failure-Mode Handling — Shared Reference

> Source of truth for **(a)** the pre-execution replay-vs-regen choice and **(b)** the post-execution failure router used by `muggle-test`, `muggle-test-feature-local`, `muggle-do-task`, and `muggle-test-regenerate-missing`. Skills MUST link here rather than restate the rules.

## The contract

Every decision in this doc follows the same shape:

1. **Classify** — pick a bucket from a fixed taxonomy based on the available signals.
2. **Suggest** — present the bucket-specific suggestion to the user via `AskUserQuestion`.
3. **User decides** — the user always makes the final call. Never auto-act.
4. **Emit telemetry** — record `(aiClassification, aiSuggestion, userAction, signals)` via `muggle-local-telemetry-event-emit` so the rules can be refined later from real data.

The classification rules below are **starting heuristics**. Trust the AI's bucket only enough to phrase a default suggestion — let the user override freely.

---

## A. Pre-execution: replay vs regen (used by `muggle-test`)

Run during change analysis, **per impacted test case**. Picks the initial execution mode before Step 7. Other skills with a single user-picked target (`muggle-test-feature-local`, `muggle-do-task`) skip this section — the user already chose.

### Inputs

- The change summary from `git diff` (file paths + diff content).
- The test case (title, description, instructions, last passing run timestamp).
- Existing test scripts for that test case from `muggle-remote-test-script-list`.

### Rules (fire in order; first match wins)

| # | Condition | Mode | Reason |
|---|---|---|---|
| 1 | No replayable/succeeded script exists for the test case | `regen` | Nothing to replay. |
| 2 | A changed file looks like UI/markup mapped to this test case (component, page, route, template, JSX/TSX/Vue/Svelte/HTML, CSS that changes layout or selectors) | `regen` | Selectors likely broken — replay would fail on staleness. |
| 3 | Last successful run was > **30 days** ago | `regen` | Drift accumulates; the saved script is stale even without a flagged change. |
| 4 | Otherwise — changes are logic-only / backend / styling-without-DOM-impact | `replay` | Selectors should still work; replay catches real regressions. |

### Mapping "changed file → test case"

Use the test case's `instructions` and `goal` text plus filenames in the diff. Match heuristically — a test case titled "Submit signup form" plus a diff in `app/auth/signup/page.tsx` is a clear match. When in doubt, prefer `regen` (rule 2 wins) — a needless regen wastes budget; a stale replay fails the test for the wrong reason.

### Telemetry

Emit **`pre-execution-classification`** for every test case in the batch, before execution starts:

```json
{
  "eventType": "pre-execution-classification",
  "skillName": "muggle-test",
  "aiClassification": "replay" | "regen",
  "aiSuggestion": "<same as classification>",
  "testCaseId": "<id>",
  "projectId": "<id>",
  "signals": ["rule-1-no-script" | "rule-2-ui-changed" | "rule-3-stale-30d" | "rule-4-default-replay"],
  "metadata": { "lastPassedAgeDays": <n>, "changedFilesMatched": ["..."] }
}
```

Skill MAY surface the per-test-case decision in the report (e.g., "regenerating 3, replaying 5") so the user can override before execution. If the user overrides, emit a follow-up event with `userAction` set to the overriding mode.

---

## B. Post-replay failure (used by all four skills with replays)

Triggered when `muggle-local-execute-replay` returns `status: "failed"` (or non-zero Electron exit) **and** the run is not an orchestration timeout already covered in `muggle-test-feature-local/SKILL.md` Step 6.

### Buckets

| Bucket | Meaning |
|---|---|
| **infra** | Something is wrong inside Muggle Test itself (e.g., click didn't register on a clearly-clickable element, Electron crash, browser engine quirk). Not the user's fault and not a stale script. |
| **stale-script** | The test script no longer matches the live UI (selectors moved, label paths changed, page renamed). The product still works; the script is out of date. |
| **product-defect** | The script and infra are fine; the user's app actually misbehaved (assertion failure on previously-passing step, unexpected error, wrong page after action). This is the failure mode acceptance testing exists to catch. |

### Initial signal heuristics

Derive signals from the run's per-step results, error messages, and step screenshots (`muggle-local-run-result-get`):

- **infra** signals: `electron-crash`, `chromium-error`, `click-no-effect-on-clickable-element`, `timeout-on-trivial-wait`, `internal-error-in-mcp-output`.
- **stale-script** signals: `element-not-found`, `selector-timeout`, `label-path-mismatch`, `nav-target-404`, `aria-label-changed`.
- **product-defect** signals: `assertion-failed-on-passing-step`, `unexpected-error-toast`, `wrong-page-after-action`, `network-500-from-app`, `form-validation-rejected-valid-input`.

If signals span multiple buckets, pick the most specific one and list all signals in telemetry — the user can override.

### Suggestions per bucket

Present via `AskUserQuestion`. The first option is the AI's recommendation (label it `(Recommended)`); always include the others so the user can redirect. **Always include "Skip — just report" so the user can opt out without committing to anything.**

| Bucket | Recommended suggestion | Other options |
|---|---|---|
| **infra** | Report bug to Muggle AI → invoke `muggle-feedback` skill with `category: "muggle-infra"` (and run id / signals). | Retry; muggle-feedback (different category); Skip. |
| **stale-script** | Regenerate the script → call `muggle-local-execute-test-generation` (or remote equivalent) for this test case, then re-replay. | Retry as-is; muggle-feedback; Skip. |
| **product-defect** | Surface as a real defect — show the failing step + screenshot + one-line summary; offer to share via email/SMS/file ticket (see "Sharing real defects" below). | muggle-feedback (if the script's *expectation* was wrong); Retry; Skip. |

### Sharing real defects

When the user picks "share / file ticket" on a `product-defect`:

1. Build a one-paragraph summary: test case title, failing step, expected-vs-actual, screenshot path, run id.
2. Ask `AskUserQuestion`: where to share?
   - Email — open `mailto:` with the summary pre-filled.
   - SMS — copy the summary to clipboard, instruct user to paste.
   - File ticket — if `gh` is available and there's a repo, offer `gh issue create` with the summary as the body; otherwise copy summary and instruct user.
   - Skip — just keep the report.
3. Record the choice in telemetry (`userAction: "share-email" | "share-sms" | "share-ticket" | "skip"`).

### Telemetry

Emit **two events per failure**: one when the AI classifies (before asking the user) and one when the user picks an action.

```json
{
  "eventType": "replay-failure-classified",
  "skillName": "<this skill>",
  "aiClassification": "infra" | "stale-script" | "product-defect",
  "aiSuggestion": "report-bug" | "regenerate" | "share-defect",
  "runId": "<local run id>",
  "testCaseId": "<id>",
  "projectId": "<id>",
  "signals": ["element-not-found", "selector-timeout"],
  "metadata": { "failingStep": "<step name>", "errorExcerpt": "<first 200 chars>" }
}
```

```json
{
  "eventType": "replay-failure-resolved",
  "skillName": "<this skill>",
  "aiClassification": "<same as above>",
  "aiSuggestion": "<same as above>",
  "userAction": "regenerate" | "report-bug" | "share-email" | "retry" | "muggle-feedback" | "skip",
  "runId": "<local run id>",
  "testCaseId": "<id>",
  "projectId": "<id>"
}
```

The `(aiSuggestion, userAction)` pair is the metric we tune from — when they diverge, the classifier needs work.

---

## C. Post-regen failure (used by all four skills with generation)

Triggered when `muggle-local-execute-test-generation` (or the remote equivalent) returns `failed`, exit 26, `goal_not_achievable`, or any other non-passing terminal state.

### Buckets

| Bucket | Meaning |
|---|---|
| **transient** | Network blip, single LLM call failed, intermittent flake. Likely succeeds on retry without changing anything. |
| **infra** | A Muggle Test bug stopped generation from progressing (handler crash, schema validation in our code, deterministic LLM-pipeline failure). |
| **agent-course** | The generation agent went down a wrong path (chose the wrong button, misread the goal, looped on a blocking modal). The product is fine and the test case is fine — the agent's *course* needs steering. |
| **product-uxux** | The product itself blocks the test (broken page, missing element, server error). Agent can't proceed because the feature doesn't actually work. |

### Initial signal heuristics

From `muggle-local-run-result-get` (summary, structured summary, last steps, error):

- **transient**: `network-error`, `llm-rate-limit`, `single-tool-call-error`, run had partial progress then died.
- **infra**: `electron-mcp-handler-crash`, `internal-validation-error`, `pipeline-stuck`, identical failure repeated more than twice.
- **agent-course**: `goal_not_achievable` with summary mentioning the agent picked a different element, looped on a modal, kept trying the same wrong action; many steps but no real progress.
- **product-uxux**: server 5xx in step screenshots, "page not found" reached repeatedly, expected element provably absent (visible in screenshot), product clearly broken in the artifact log.

### Suggestions per bucket

Present via `AskUserQuestion`. **Always show the run summary first** so the user has context, then offer the bucket's recommended action plus alternatives.

| Bucket | Recommended suggestion | Other options |
|---|---|---|
| **transient** | Retry as-is. | muggle-feedback; Edit test case; Skip. |
| **infra** | Report bug to Muggle AI → `muggle-feedback` with `category: "muggle-infra"` (run id, signals, summary excerpt). | Retry; Skip. |
| **agent-course** | Steer the agent → invoke `muggle-feedback` skill so the user describes what should have happened; the workflow re-runs with the corrected course. | Retry; Edit test case; Skip. |
| **product-uxux** | Wait for fix — share the run summary + screenshot to the dev. Offer email / SMS / file ticket (see "Sharing real defects" in section B). | Retry once the fix lands; muggle-feedback; Skip. |

### Telemetry

Same two-event pattern as section B, with `eventType` values `regen-failure-classified` and `regen-failure-resolved`. `aiClassification` is one of the four bucket strings; `userAction` is the user's pick.

```json
{
  "eventType": "regen-failure-classified",
  "skillName": "<this skill>",
  "aiClassification": "transient" | "infra" | "agent-course" | "product-uxux",
  "aiSuggestion": "retry" | "report-bug" | "muggle-feedback" | "wait-and-share",
  "runId": "<local run id>",
  "testCaseId": "<id>",
  "projectId": "<id>",
  "signals": ["goal_not_achievable", "loop-on-modal"],
  "metadata": { "summary": "<excerpt>", "stepsCompleted": <n> }
}
```

---

## D. Emitting telemetry — implementation notes

- Tool: `muggle-local-telemetry-event-emit` (local-only, fire-and-forget).
- Sink: `~/.muggle-ai/telemetry/failure-events.jsonl` (one JSON record per line, append-only).
- Never block the skill on a telemetry call. If the tool errors, log and continue.
- Always emit the **classified** event before asking the user, and the **resolved** event immediately after the user picks. Don't merge them into one event after the fact — the *latency* between AI suggestion and user choice is also data.
- For the pre-execution classifier (section A), the event has no separate "resolved" pair unless the user actively overrides; if they do, emit a single follow-up `pre-execution-classification` event with `userAction` set.

## E. What this doc deliberately does not bake in

- **Quantitative thresholds** beyond rule A.3 (30-day drift). Bucket signal lists above are an initial best guess; once telemetry has data, the user will refine which signals reliably indicate which bucket.
- **Auto-retry**. There is no "if X then automatically rerun" path anywhere. The user decides every time — that's the whole point of the contract.
- **Cross-bucket fallbacks**. If the AI mis-classifies, the user picks a different option from the AskUserQuestion list; the AI does not retry classification.
