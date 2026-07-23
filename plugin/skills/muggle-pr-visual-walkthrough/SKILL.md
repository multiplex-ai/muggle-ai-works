---
name: muggle-pr-visual-walkthrough
model: sonnet
description: Renders and posts a visual walkthrough of Muggle AI E2E acceptance test results to a PR — per-test-case dashboard links, step-by-step screenshots, and pass/fail summary — using the `muggle build-pr-section` CLI for deterministic formatting with automatic fit-vs-overflow. Use at the end of any Muggle Test test run (local or remote) to give PR reviewers clickable visual evidence that user flows work. Triggers on 'post results to PR', 'attach walkthrough to PR', 'share E2E screenshots on the PR', 'add visual walkthrough to PR'.
---

# Muggle Test PR Visual Walkthrough

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-pr-visual-walkthrough"`.

Renders a visual walkthrough of Muggle AI E2E acceptance test results and posts it to a PR. Each test case links to its detail page on the Muggle AI dashboard, so reviewers can click through to step-by-step screenshots — not just a pass/fail flag.

This skill is a **dispatcher**: it resolves the mode and any user interaction, then hands execution to the `visual-walkthrough-builder` agent (`plugin/agents/visual-walkthrough-builder.md`). The agent carries `model: sonnet`, which — unlike this file's `model:` — applies even when the skill fires mid-session in a live conversation; that pin gap is why execution lives in the agent. The agent owns E2eReport assembly, `muggle build-pr-section` rendering, the fit-vs-overflow contract, and Mode A posting.

This is the **canonical PR-walkthrough workflow** shared across every Muggle Test entry point:

| Caller | Mode | When to invoke |
| :--- | :--- | :--- |
| `muggle-test` | **Mode A** (post to existing PR) | After publishing results, user opts in via `AskUserQuestion` |
| `muggle-test-feature-local` | **Mode A** (post to existing PR) | After publishing the run, user opts in via `AskUserQuestion` |
| `muggle-do` / `open-prs.md` | **Mode B** (render-only for embedding) | During PR creation — caller embeds `body` in the PR create call and posts `comment` as follow-up |
| `muggle-test` Mode C / `acceptance-tester` agent | **Mode C** (embed in verdict comment) | Inside an open-PR sweep orchestrator — caller folds the rendered body into a single per-PR verdict comment |

## Preferences

Callers consult the `postPRVisualWalkthrough` gate **before** invoking this skill — by the time it runs, posting is already approved. Per-key gate definitions live in `plugin/skills/muggle-preferences/preference-gates/`.

## Procedure

1. **Resolve the mode.** Chosen by the caller, never the user: top-level `muggle-test`/`muggle-test-feature-local` → `post` (Mode A); `muggle-do` PR creation → `render-for-new-pr` (Mode B); an orchestrator passing `mode: "embed"` → Mode C.
2. **Mode A only — find the PR** with `gh pr view --json number,url,title`. No PR on the branch → `AskUserQuestion`: create a new PR with the walkthrough in the body (switch to Mode B and hand the rendered block back to the caller), or skip posting. `gh` missing/unauthenticated → tell the user, suggest `gh auth login`, stop. This is the skill's only interactive branch — resolve it **before** dispatching.
3. **Gather the inputs.** The `E2eReport` JSON if the caller already assembled it (see [`e2e-report-assembly.md`](e2e-report-assembly.md)), else the run identifiers (`projectId`, per-test `runId`/`testCaseId`) the agent needs to assemble it.
4. **Dispatch** the `visual-walkthrough-builder` agent (subagent type `muggle:visual-walkthrough-builder`; bare `visual-walkthrough-builder` where the plugin namespace is absent), synchronously, passing: mode, PR number + repo (Mode A), and the report JSON or identifiers. In a harness with no agent/subagent facility, execute `plugin/agents/visual-walkthrough-builder.md` inline instead.
5. **Relay the result.** Mode A → confirm to the user with the PR URL. Modes B/C → return the agent's `{body, comment}` to the caller verbatim; the caller owns PR creation (Mode B) or the single verdict comment (Mode C). A `needs-input:` line from the agent names a missing report field — surface it to the caller; never fabricate the field.

## Guardrails

- The rendered markdown is CLI-owned end to end — this skill never writes, edits, or post-processes it; those rules ride with the agent.
- Mode is chosen by the caller, not the user.
- Never create a PR without confirmation in Mode A.
- Don't run tests — this skill only dispatches rendering/posting of existing results. No report and no run identifiers in context → redirect the caller to `muggle-test`, `muggle-test-feature-local`, or `muggle-do`.
