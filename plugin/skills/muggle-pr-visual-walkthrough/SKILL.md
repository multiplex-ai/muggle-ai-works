---
name: muggle-pr-visual-walkthrough
description: Renders and posts a visual walkthrough of Muggle AI E2E acceptance test results to a PR — per-test-case dashboard links, step-by-step screenshots, and pass/fail summary — using the `muggle build-pr-section` CLI for deterministic formatting with automatic fit-vs-overflow. Use at the end of any Muggle Test test run (local or remote) to give PR reviewers clickable visual evidence that user flows work. Triggers on 'post results to PR', 'attach walkthrough to PR', 'share E2E screenshots on the PR', 'add visual walkthrough to PR'.
---

# Muggle Test PR Visual Walkthrough

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-pr-visual-walkthrough"`.

Renders a visual walkthrough of Muggle AI E2E acceptance test results and posts it to a PR. Each test case is linked to its detail page on the Muggle AI dashboard, so PR reviewers can click through to see step-by-step screenshots and action scripts — not just a pass/fail flag.

This is the **canonical PR-walkthrough workflow** shared across every Muggle Test entry point:

| Caller | Mode | When to invoke |
| :--- | :--- | :--- |
| `muggle-test` | **Mode A** (post to existing PR) | After publishing results, user opts in via `AskUserQuestion` |
| `muggle-test-feature-local` | **Mode A** (post to existing PR) | After publishing the run, user opts in via `AskUserQuestion` |
| `muggle-do` / `open-prs.md` | **Mode B** (render-only for embedding) | During PR creation — caller embeds `body` in `gh pr create` and posts `comment` as follow-up |
| `muggle-test` Mode C / `acceptance-tester` agent | **Mode C** (embed in verdict comment) | Inside a PR-loop orchestrator — caller folds the rendered body into a single per-PR verdict comment instead of posting separately |

Rendering is always done by `muggle build-pr-section`, a battle-tested CLI that handles deterministic markdown layout, per-step screenshots, and automatic fit-vs-overflow (oversized content spills into a follow-up comment). Never hand-write the walkthrough markdown.

## Preferences

This skill is invoked by callers (`muggle-test`, `muggle-test-feature-local`, `muggle-do`) **after** the caller has already consulted the `postPRVisualWalkthrough` gate and decided to post. Therefore **the gating happens upstream, not in this skill** — by the time this skill runs, the user has already approved posting (either via the saved gate value or by explicit pick).

| Preference | Where it's gated | Decision it gates |
|------------|------------------|-------------------|
| `postPRVisualWalkthrough` | Caller skill (e.g. `muggle-test` Step 9, `muggle-test-feature-local` Step 10) | Post visual walkthrough to PR |

Per-key gate definitions live in `plugin/skills/muggle-preferences/preference-gates/`. This skill only renders and posts.

## Input contract: the `E2eReport` JSON

Every caller must build an `E2eReport` JSON object and have it in conversation context before invoking this skill. The schema is defined in `src/cli/pr-section/types.ts` (`E2eReportSchema`) and enforced by the CLI with Zod — malformed input exits non-zero with a descriptive stderr message.

```json
{
  "projectId": "<UUID>",
  "tests": [
    {
      "name": "<test case title>",
      "description": "<one-line description of what this test verifies>",
      "useCaseName": "<parent use case title>",
      "testCaseId": "<UUID>",
      "testScriptId": "<UUID>",
      "runId": "<UUID>",
      "viewUrl": "https://www.muggle-ai.com/...",
      "status": "passed",
      "steps": [
        { "stepIndex": 0, "action": "Click login button", "screenshotUrl": "https://..." },
        { "stepIndex": 1, "action": "Type email", "screenshotUrl": "https://..." }
      ]
    },
    {
      "name": "Checkout flow",
      "description": "Verify a shopper can complete checkout with a saved card.",
      "useCaseName": "Purchase",
      "testCaseId": "<UUID>",
      "testScriptId": "<UUID>",
      "runId": "<UUID>",
      "viewUrl": "https://www.muggle-ai.com/...",
      "status": "failed",
      "steps": [
        { "stepIndex": 0, "action": "Open cart", "screenshotUrl": "https://..." }
      ],
      "failureStepIndex": 2,
      "error": "Element not found: Click checkout button",
      "artifactsDir": "/Users/.../~/.muggle-ai/sessions/<runId>"
    },
    {
      "name": "Clear search input restores full list",
      "description": "Verify clearing the search input restores all options.",
      "useCaseName": "Filter Dropdowns",
      "testCaseId": "<UUID>",
      "runId": "<UUID>",
      "viewUrl": "https://www.muggle-ai.com/...",
      "status": "inconclusive",
      "steps": [],
      "reason": "No replayable script exists yet — needs first generation run."
    }
  ]
}
```

Required fields per test: `name`, `testCaseId`, `runId`, `viewUrl`, `status`, `steps[]` with `{stepIndex, action, screenshotUrl}`.

- **Failed** tests additionally require `failureStepIndex` and `error`.
- **Inconclusive** tests additionally require `reason` (one short sentence on why the result is neither pass nor fail). `steps[]` may be empty — that's fine. Inconclusive is for runs that couldn't be classified pass/fail (no replayable script, environment precondition unmet, infra error blocked execution, agent stalled before reaching the assertion). **Never silently drop these — always emit them as `inconclusive`.** The CLI counts them in the overview and renders an `⚠️` row with the dashboard link so reviewers can click through. If you find yourself wanting to skip a test or hand-write a comment because the schema "doesn't fit," that is the schema fitting — use `inconclusive`.

### Verdict

The renderer computes a verdict from the tests and emits a `**Verdict:** ✅ PASS | ❌ FAIL | ⚠️ INCONCLUSIVE` line at the top of the overview. The policy is strict:

- Any failed test → **FAIL** (regardless of how many passed or are inconclusive).
- No failures but any inconclusive → **INCONCLUSIVE**.
- All passed → **PASS**.
- Empty report → no verdict line.

You do not compute or render the verdict yourself — the CLI does. Never write a "Verdict: PASS" line into a hand-edited summary; it will conflict with the CLI's computed verdict.

**Optional but recommended** per test:
- `description` — a one-line summary of what the test case verifies. Shown in the collapsible header for each test and helps reviewers understand the test without expanding it. Pull from the test case's `title`/`description` via `muggle-remote-test-case-get`.
- `useCaseName` — the parent use case title. When present on any test, the overview list is grouped by use case; otherwise it is rendered as a flat list. Pull from `muggle-remote-use-case-get` using the test case's parent use-case id.
- `testScriptId` and `artifactsDir` are also optional.

If any required field is missing, stop and tell the caller exactly what's missing. Never fabricate data.

## Step 1: Assemble the `E2eReport`

Read `plugin/skills/muggle-pr-visual-walkthrough/e2e-report-assembly.md` for the full assembly guide.

## Step 2: Render via `muggle build-pr-section`

Pipe the `E2eReport` JSON to the CLI. It writes `{"body": "...", "comment": "..." | null}` to stdout — the `body` is the E2E markdown block, and `comment` is a non-null overflow comment only when the full body exceeds the byte budget (default 60 KB).

```bash
echo "$REPORT_JSON" | muggle build-pr-section > /tmp/muggle-pr-section.json
```

- Exit **non-zero** → the CLI wrote a descriptive error to stderr. Surface it to the user; do not swallow it.
- `comment` is **`null`** (fit case) → everything is inline in `body`. Post `body` only.
- `comment` is a **non-null string** (overflow case) → `body` contains the summary + a pointer; `comment` contains the full per-step details. Post both, in order.

Never hand-write the walkthrough markdown. Never modify the CLI's output before posting. The CLI owns the format.

## Step 3 — Mode A: Post to an existing PR

Used by `muggle-test` and `muggle-test-feature-local`, where the user is mid-development and a PR already exists on the current branch.

### 3A.1: Find the PR

```bash
gh pr view --json number,url,title 2>/dev/null
```

- **PR exists** → continue to 3A.2
- **No PR exists** → use `AskUserQuestion`:
  - "Create a new PR with the visual walkthrough in the body"
  - "Skip posting"
  - If the user chooses to create a new PR, switch to Mode B and return the rendered `body`/`comment` to the caller for embedding in `gh pr create`. Do not create the PR directly from this skill unless the caller has no better way to do it.
- **`gh` not installed or not authenticated** → tell the user, suggest `gh auth login`, stop.

### 3A.2: Post the body as a PR comment

Extract the `body` field with `jq -r` (not `sed`) so JSON escape sequences are properly decoded, then pipe to `--body-file -`:

```bash
jq -r '.body' /tmp/muggle-pr-section.json | gh pr comment <pr-number> --body-file -
```

### 3A.3: Post the overflow comment only if the CLI emitted one

```bash
jq -r '.comment' /tmp/muggle-pr-section.json | gh pr comment <pr-number> --body-file -
```

**Skip this step entirely if `comment` is `null`** — do not post a placeholder. The CLI decides fit-vs-overflow; never post the overflow comment speculatively.

### 3A.4: Confirm to the user

> "Visual walkthrough posted to PR #<number>. Reviewers can click any test case link to see the step-by-step screenshots on the Muggle AI dashboard."

Include the PR URL in the confirmation.

## Step 3 — Mode B: Return rendered block for embedding in a new PR

Used by `muggle-do`'s `open-prs.md`, where the PR does not exist yet and the caller is assembling the PR body from multiple sections (`## Goal`, `## Acceptance Criteria`, `## Changes`, plus this walkthrough).

Instead of posting, **return** the CLI output to the caller's context so they can:

1. **Embed `body`** in their PR body, concatenated after `## Changes`. `body` already includes its own `## E2E Acceptance Results` header — do not add another.
2. **Create the PR** with `gh pr create --title "..." --body "..."` using the concatenated body.
3. **Post `comment` as a follow-up only if the CLI emitted one:**

   ```bash
   jq -r '.comment' /tmp/muggle-pr-section.json | gh pr comment <new-pr-number> --body-file -
   ```

   Skip if `comment` is `null`.

In Mode B, this skill does not call `gh pr comment` or `gh pr create` itself — the caller owns PR creation because it also owns branch pushing, title building (including `[E2E FAILING]` prefix on failures), and multi-repo orchestration.

## Step 3 — Mode C: Embed mode for PR-loop orchestrators

Used when invoked as a sub-step of a PR-loop orchestrator (see `plugin/skills/muggle-test/SKILL.md` Mode C) rather than as a top-level user invocation. The orchestrator's `acceptance-tester` subagent (see `plugin/agents/acceptance-tester.md`) composes a **single per-PR verdict comment** and folds the walkthrough into it — posting separately would create 2–3 disparate comments per test cycle and clutter the PR.

### 3C.1: Detect embed mode

The caller passes `mode: "embed"` as a skill argument. Default behavior (no `mode` passed, or `mode: "post"`) is Mode A — unchanged.

### 3C.2: Render but do not post

Run `muggle build-pr-section` exactly as in Step 2. Then, **instead of calling `gh pr comment`**:

1. **Return** the CLI output (`{ body, comment }`) to the caller as this skill's result.
2. Do **not** find a PR, do **not** post a standalone comment, do **not** prompt the user.
3. If `comment` is non-null (overflow case), return it alongside `body` — the orchestrator decides how to handle overflow (typically: inline `body` in the verdict comment, post `comment` as a follow-up).

### 3C.3: Hand off

The orchestrator (`acceptance-tester`) concatenates the returned `body` into its verdict comment template alongside the verdict summary, change-list, and any other sections it owns, then posts a single `gh pr comment` itself. This skill's job ends at returning the rendered markdown.

In Mode C, the same fit-vs-overflow contract from Step 2 applies — never modify the CLI's output, never fabricate fields, never post anything. The caller owns posting.

## Tool Reference

| Phase | Tool |
|:------|:-----|
| Gather per-step data (muggle-test, muggle-test-feature-local) | `muggle-remote-test-script-get` |
| Render the walkthrough markdown | `muggle build-pr-section` (shell) |
| Find existing PR (Mode A) | `gh pr view` |
| Post comment(s) (Mode A) | `gh pr comment` |
| Create new PR (Mode B, caller handles) | `gh pr create` |
| User confirmation (Mode A no-PR branch) | `AskUserQuestion` |

## Guardrails

- **Never hand-write the walkthrough markdown** — always call `muggle build-pr-section`. The CLI is the single source of truth for formatting. If a test outcome doesn't fit `passed | failed`, that's what `inconclusive` is for — never fall back to a hand-written summary, a custom table, a "Verdict: PASS" header, a `Tested on:`/`Project:` footer, or any other freeform text. The CLI already emits per-test-case dashboard links (no project-level link), uses `https://www.muggle-ai.com/...` URLs (never the test target's `localhost` URL), and computes the verdict — anything you would manually add is wrong by construction.
- **Never modify the CLI's output** — post `body` and (if present) `comment` verbatim. Any reformatting defeats the fit-vs-overflow budget math.
- **Never invent report fields** — if `projectId`, a per-test `viewUrl`, or per-step `screenshotUrl` is missing, stop and report what's missing. Do not fabricate URLs or fill in placeholders.
- **Never post the overflow comment when `comment` is `null`** — the CLI decides fit-vs-overflow.
- **Never create a PR without confirmation in Mode A** — if no PR exists, ask the user or switch to Mode B and hand back to the caller.
- **Don't run tests** — this skill only renders and posts existing results. If the `E2eReport` is not in context, redirect the caller to `muggle-test`, `muggle-test-feature-local`, or `muggle-do`.
- **Mode is chosen by the caller, not the user** — `muggle-test` top-level uses Mode A; `muggle-do` uses Mode B; PR-loop orchestrators (`muggle-test` Mode C / `acceptance-tester`) pass `mode: "embed"` for Mode C. Don't ask the user which mode to use.
- **Never post in Mode C** — when `mode: "embed"` is passed, return the rendered body to the caller and stop. The orchestrator owns the single verdict comment.
