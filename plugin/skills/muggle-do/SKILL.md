---
name: muggle-do
description: Unified Muggle AI workflow entry point. Use when user types muggle do or asks for autonomous implementation to PR.
disable-model-invocation: true
---

# Muggle Do

Muggle Do runs a battle-tested autonomous dev cycle: **pre-flight → requirements → impact analysis → validate code → unit tests → E2E acceptance → open PR**.

The design goal is **fire and review**: the user answers one consolidated pre-flight questionnaire, then walks away. Every subsequent stage runs unattended until completion or a genuine blocker.

For maintenance tasks, use the dedicated skills:

- `/muggle:muggle-status`
- `/muggle:muggle-repair`
- `/muggle:muggle-upgrade`

## Input routing

Treat `$ARGUMENTS` as the user command:

- Empty / `help` / `menu` / `?` → show menu and session selector.
- Anything else → treat as a new task description and start/resume a dev-cycle session.

## The seven stages

| # | Stage | File | User-facing? |
| :- | :---- | :--- | :----------- |
| 1 | Pre-flight | [../do/pre-flight.md](../do/pre-flight.md) | **Yes — single consolidated turn** |
| 2 | Requirements | [../do/requirements.md](../do/requirements.md) | No |
| 3 | Impact analysis | [../do/impact-analysis.md](../do/impact-analysis.md) | No |
| 4 | Validate code | [../do/validate-code.md](../do/validate-code.md) | No |
| 5 | Unit tests | [../do/unit-tests.md](../do/unit-tests.md) | No |
| 6 | E2E acceptance | [../do/e2e-acceptance.md](../do/e2e-acceptance.md) | No |
| 7 | Open PR | [../do/open-prs.md](../do/open-prs.md) | No |

**Stage 1 (pre-flight) is the ONLY stage that talks to the user.** Stages 2–7 run silently to completion. If a later stage hits a genuine blocker that the pre-flight didn't cover, escalate with a single terminal message — do not open a second round of questions.

## Front-loading (stage 1 non-negotiable)

All ambiguity — task scope, repo selection, validation strategy, localhost URL, backend health, Muggle project, test-user credentials, branch name, PR target — is resolved in a **single** pre-flight turn. See `pre-flight.md` for the exact questionnaire.

**Red-flag behaviors (do not do):**

- Asking a clarifying question mid-cycle because "I didn't think of that at pre-flight."
- Starting a dev server mid-cycle and discovering the port is wrong.
- Reaching the E2E stage before knowing how the user wants it validated.
- Asking the user to "pick one" across multiple turns instead of one turn.

If any of these happen, the pre-flight was incomplete — treat it as a skill bug, not a user bug, and expand `pre-flight.md` to cover the missed case after the run.

## Session model

Every run writes to `.muggle-do/sessions/<slug>/`:

- `state.md` — one-screen live status: current stage (N/7), last update timestamp, pre-flight answers verbatim, any blockers.
- `iterations/<NNN>.md` — append-only log of stage transitions for iteration NNN: what ran, what was decided, what artifacts were produced.
- `requirements.md` — frozen output of stage 2.
- `result.md` — final summary written by stage 7 (PR URLs, E2E outcome, open issues).

**On every stage transition, you MUST:**

1. Append a dated entry to the active `iterations/<NNN>.md`: `### Stage N/7 — <name> (<timestamp>)` followed by the stage's output.
2. Rewrite `state.md` to reflect the new current stage and any relevant counters.

If these files don't exist, create them — missing session files means the user lost visibility into the cycle, which is the exact failure mode this skill exists to prevent.

## Turn preamble

Each stage turn MUST begin with one line in this form before any other output:

```
**Stage N/7 — <stage name>** — <one-line intent>
```

This is how the user can tell, at a glance, what phase the cycle is in without parsing a long response.

## Guardrails

- **No mid-cycle user questions.** Anything not covered by pre-flight is a skill bug; escalate once, do not loop.
- **Do not skip unit tests before E2E acceptance tests.**
- **Do not skip E2E acceptance tests due to missing scripts** — generate when needed.
- **Do not hand-write the E2E block of the PR body.** The `open-prs.md` stage MUST invoke `muggle-pr-visual-walkthrough` Mode B to render the screenshots-and-steps section. Hand-writing it loses the dashboard links the user relies on for review.
- **If the same stage fails 3 times in a row, escalate with details.**
- **If total iterations reach 3 and E2E acceptance tests still fail**, continue to PR creation with `[E2E FAILING]` in the title; the visual walkthrough section makes the failures reviewable.

## Completion contract

When stage 7 finishes, the final message to the user contains at minimum:

- PR URL(s)
- E2E status (passing / `[E2E FAILING]`)
- Link to the run dashboard for each test case (via the walkthrough skill output)
- Path to `result.md` for full details

No other content. The user already read the walkthrough in the PR body — do not re-summarize it here.
