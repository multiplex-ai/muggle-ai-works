---
name: muggle-pr-visual-walkthrough
description: Renders and posts a visual walkthrough of Muggle AI E2E acceptance test results to a PR — per-test-case dashboard links, step-by-step screenshots, and pass/fail summary — using the `muggle build-pr-section` CLI for deterministic formatting with automatic fit-vs-overflow. Use at the end of any Muggle test run (local or remote) to give PR reviewers clickable visual evidence that user flows work. Triggers on 'post results to PR', 'attach walkthrough to PR', 'share E2E screenshots on the PR', 'add visual walkthrough to PR'.
---

# Muggle PR Visual Walkthrough

Renders a visual walkthrough of Muggle AI E2E acceptance test results and posts it to a PR. Each test case is linked to its detail page on the Muggle AI dashboard, so PR reviewers can click through to see step-by-step screenshots and action scripts — not just a pass/fail flag.

This is the **canonical PR-walkthrough workflow** shared across every Muggle entry point:

| Caller | Mode | When to invoke |
| :--- | :--- | :--- |
| `muggle-test` | **Mode A** (post to existing PR) | After publishing results, user opts in via `AskQuestion` |
| `muggle-test-feature-local` | **Mode A** (post to existing PR) | After publishing the run, user opts in via `AskQuestion` |
| `muggle-do` / `open-prs.md` | **Mode B** (render-only for embedding) | During PR creation — caller embeds `body` in `gh pr create` and posts `comment` as follow-up |

Rendering is always done by `muggle build-pr-section`, a battle-tested CLI that handles deterministic markdown layout, per-step screenshots, and automatic fit-vs-overflow (oversized content spills into a follow-up comment). Never hand-write the walkthrough markdown.

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
    }
  ]
}
```

Required fields per test: `name`, `testCaseId`, `runId`, `viewUrl`, `status`, `steps[]` with `{stepIndex, action, screenshotUrl}`. Failed tests additionally require `failureStepIndex` and `error`.

**Optional but recommended** per test:
- `description` — a one-line summary of what the test case verifies. Shown in the collapsible header for each test and helps reviewers understand the test without expanding it. Pull from the test case's `title`/`description` via `muggle-remote-test-case-get`.
- `useCaseName` — the parent use case title. When present on any test, the overview list is grouped by use case; otherwise it is rendered as a flat list. Pull from `muggle-remote-use-case-get` using the test case's parent use-case id.
- `testScriptId` and `artifactsDir` are also optional.

If any required field is missing, stop and tell the caller exactly what's missing. Never fabricate data.

## Step 1: Gather the `E2eReport`

How to assemble the JSON depends on which caller you are:

### From `muggle-test` / `muggle-test-feature-local` (local mode)

After `muggle-local-publish-test-script` returns `{testScriptId, viewUrl, ...}` for each run:

1. Call `muggle-remote-test-script-get` with `testScriptId` to fetch the published script.
2. Extract `steps[]` — for each step, build `{stepIndex: <index>, action: operation.action, screenshotUrl: operation.screenshotUrl}`.
3. Determine `status` from the local run result (`muggle-local-run-result-get`).
4. For failures, read `failureStepIndex`, `error`, and `artifactsDir` from the run result.
5. Assemble the `E2eReport` with `projectId` from the test run.
6. Populate `description` (test case title/description) and `useCaseName` (parent use case title) on each report entry — optional but strongly recommended; they drive the grouped overview and the per-test collapsible headers. Prefer values already in your conversation context from earlier steps (e.g. a test case you just created or selected, or a use case you confirmed); only call `muggle-remote-test-case-get` / `muggle-remote-use-case-get` for anything you don't already have.

### From `muggle-do` (`open-prs.md`)

The `e2e-acceptance.md` stage already produces an `E2eReport` with the exact shape above — that is the report's native output format. Pass it through unchanged.

### Direct invocation (user asked to post existing results)

The caller must have already executed tests and published them. If the `E2eReport` is not in context, stop and tell the user to run `muggle-test` or `muggle-test-feature-local` first.

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
- **No PR exists** → use `AskQuestion`:
  - "Create a new PR with the visual walkthrough in the body"
  - "Skip posting"
  - If the user chooses to create a new PR, switch to Mode B and return the rendered `body`/`comment` to the caller for embedding in `gh pr create`. Do not create the PR directly from this skill unless the caller has no better way to do it.
- **`gh` not installed or not authenticated** → tell the user, suggest `gh auth login`, stop.

### 3A.2: Post the body as a PR comment

```bash
gh pr comment <pr-number> --body "$(cat <<'EOF'
<contents of body field from CLI output>
EOF
)"
```

### 3A.3: Post the overflow comment only if the CLI emitted one

```bash
gh pr comment <pr-number> --body "$(cat <<'EOF'
<contents of comment field from CLI output>
EOF
)"
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
   gh pr comment <new-pr-number> --body "$(cat <<'EOF'
   <contents of comment field>
   EOF
   )"
   ```

   Skip if `comment` is `null`.

In Mode B, this skill does not call `gh pr comment` or `gh pr create` itself — the caller owns PR creation because it also owns branch pushing, title building (including `[E2E FAILING]` prefix on failures), and multi-repo orchestration.

## Tool Reference

| Phase | Tool |
|:------|:-----|
| Gather per-step data (muggle-test, muggle-test-feature-local) | `muggle-remote-test-script-get` |
| Render the walkthrough markdown | `muggle build-pr-section` (shell) |
| Find existing PR (Mode A) | `gh pr view` |
| Post comment(s) (Mode A) | `gh pr comment` |
| Create new PR (Mode B, caller handles) | `gh pr create` |
| User confirmation (Mode A no-PR branch) | `AskQuestion` |

## Guardrails

- **Never hand-write the walkthrough markdown** — always call `muggle build-pr-section`. The CLI is the single source of truth for formatting.
- **Never modify the CLI's output** — post `body` and (if present) `comment` verbatim. Any reformatting defeats the fit-vs-overflow budget math.
- **Never invent report fields** — if `projectId`, a per-test `viewUrl`, or per-step `screenshotUrl` is missing, stop and report what's missing. Do not fabricate URLs or fill in placeholders.
- **Never post the overflow comment when `comment` is `null`** — the CLI decides fit-vs-overflow.
- **Never create a PR without confirmation in Mode A** — if no PR exists, ask the user or switch to Mode B and hand back to the caller.
- **Don't run tests** — this skill only renders and posts existing results. If the `E2eReport` is not in context, redirect the caller to `muggle-test`, `muggle-test-feature-local`, or `muggle-do`.
- **Mode A vs Mode B is chosen by the caller, not the user** — `muggle-test` always uses Mode A; `muggle-do` always uses Mode B. Don't ask the user which mode to use.
