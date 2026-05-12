---
name: muggle-do
description: Unified Muggle AI workflow entry point. Use when user types muggle do or asks for autonomous implementation to PR.
disable-model-invocation: true
---

# Muggle Test Do

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-do"`.

Muggle Test Do runs a battle-tested autonomous dev cycle: **pre-flight → requirements → impact analysis → validate code → unit tests → E2E acceptance → open PR → PR follow-up**.

The design goal is **fire and review**: the user answers one consolidated pre-flight questionnaire, then walks away. Every subsequent stage runs unattended until completion or a genuine blocker. After the PR opens, a detached `/loop` keeps addressing reviewer comments and CI failures until the PR is merged or closed.

For maintenance tasks, use the dedicated skills:

- `/muggle:muggle-status`
- `/muggle:muggle-repair`
- `/muggle:muggle-upgrade`

## Preferences

Gates run per [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md).

| Preference | Stage | Decision it gates |
|------------|-------|-------------------|
| `autoUseWorktree` | 1 (pre-flight) | Create a worktree (see [`_shared/use-worktrees.md`](../_shared/use-worktrees.md)) |
| `autoE2ETest` | 6 (e2e-acceptance) | Run E2E every cycle (default `always`), or fold the question into pre-flight |
| `autoRebase` | 6 (e2e-acceptance) | Rebase onto `origin/<default>` (see [`_shared/rebase-before-e2e.md`](../_shared/rebase-before-e2e.md)) |
| `autoCreatePR` | 7 (open-prs) | Push the branch and open the PR (see [`do/open-prs.md`](../do/open-prs.md)) |
| `autoCleanup` | 7 (post-merge) | Run cleanup sequence (see [`_shared/post-merge-cleanup.md`](../_shared/post-merge-cleanup.md)) |

## Input routing

Treat `$ARGUMENTS` as the user command:

- Empty / `help` / `menu` / `?` → show menu and session selector.
- Anything else → infer intent:
  - **Task automation** (user wants to perform an action on a website — post something, fill a form, click through a flow) → invoke `muggle:muggle-do-task` skill with the full prompt as arguments.
  - **Feature development** (user wants to build, implement, fix, or refactor code) → treat as a new task description and start/resume a dev-cycle session.

  When in doubt, ask one question: "Do you want me to run this as a browser automation task, or implement it as a code change?"

## The eight stages

| # | Stage | File | User-facing? |
| :- | :---- | :--- | :----------- |
| 1 | Pre-flight | [../do/pre-flight.md](../do/pre-flight.md) | **Yes — single consolidated turn** |
| 2 | Requirements | [../do/requirements.md](../do/requirements.md) | No |
| 3 | Impact analysis | [../do/impact-analysis.md](../do/impact-analysis.md) | No |
| 4 | Validate code | [../do/validate-code.md](../do/validate-code.md) | No |
| 5 | Unit tests | [../do/unit-tests.md](../do/unit-tests.md) | No |
| 6 | E2E acceptance | [../do/e2e-acceptance.md](../do/e2e-acceptance.md) | No |
| 7 | Open PR | [../do/open-prs.md](../do/open-prs.md) | No |
| 8 | PR follow-up | [../do/pr-followup.md](../do/pr-followup.md) | **Yes — only on ambiguous review comments** |

**Stage 1 (pre-flight) is the only stage that talks to the user during the dev cycle proper.** Stages 2–7 run silently to completion. Stage 8 runs detached (via `/loop`) after stage 7 hands off, and it may escalate to the user once if it encounters a review comment it cannot classify as a clear directive or question — see [Guardrails](#guardrails) below.

If a stage 2–7 hits a genuine blocker that the pre-flight didn't cover, escalate with a single terminal message — do not open a second round of questions.

## Front-loading (stage 1 non-negotiable)

All ambiguity — task scope, repo selection, validation strategy, localhost URL, backend health, Muggle Test project, test-user credentials, branch name, PR target — is resolved in a **single** pre-flight turn. See `pre-flight.md` for the exact questionnaire.

**Red-flag behaviors (do not do):**

- Asking a clarifying question mid-cycle because "I didn't think of that at pre-flight."
- Starting a dev server mid-cycle and discovering the port is wrong.
- Reaching the E2E stage before knowing how the user wants it validated.
- Asking the user to "pick one" across multiple turns instead of one turn.

If any of these happen, the pre-flight was incomplete — treat it as a skill bug, not a user bug, and expand `pre-flight.md` to cover the missed case after the run.

## Session model

Every run writes to `.muggle-do/sessions/<slug>/`:

- `state.md` — one-screen live status: current stage (N/8), last update timestamp, pre-flight answers verbatim, any blockers. While stage 8 is running, also tracks the tick counter and per-PR idle-tick counts.
- `iterations/<NNN>.md` — append-only log of stage transitions for iteration NNN: what ran, what was decided, what artifacts were produced.
- `requirements.md` — frozen output of stage 2.
- `result.md` — initial summary written by stage 7 (PR URLs, E2E outcome). If stage 8 was dispatched, it overwrites `result.md` on its terminating tick with the final post-merge picture (per-PR final state, count of items addressed and escalated, final commit SHA).
- `prs.json`, `last_seen.json`, `followup.log` — owned by stage 8 only; see [`../do/pr-followup.md`](../do/pr-followup.md).

**On every stage transition, you MUST:**

1. Append a dated entry to the active `iterations/<NNN>.md`: `### Stage N/8 — <name> (<timestamp>)` followed by the stage's output.
2. Rewrite `state.md` to reflect the new current stage and any relevant counters.

If these files don't exist, create them — missing session files means the user lost visibility into the cycle, which is the exact failure mode this skill exists to prevent.

## Turn preamble

Each stage turn MUST begin with one line in this form before any other output:

```
**Stage N/8 — <stage name>** — <one-line intent>
```

This is how the user can tell, at a glance, what phase the cycle is in without parsing a long response.

## Guardrails

- **No mid-cycle user questions in stages 2–7.** Anything not covered by pre-flight is a skill bug; escalate once, do not loop.
  - **Stage 8 is the deliberate exception.** It runs detached and may escalate to the user once when a reviewer comment cannot be classified as a clear directive or question (default-pause on ambiguity). The user has already walked away by then, and guessing on an ambiguous design comment risks pushing a wrong change. See [`../do/pr-followup.md`](../do/pr-followup.md) for the classification rule.
- **Do not skip unit tests before E2E acceptance tests.**
- **Do not skip E2E acceptance tests due to missing scripts** — generate when needed.
- **Do not hand-write the E2E block of the PR body.** The `open-prs.md` stage MUST invoke `muggle-pr-visual-walkthrough` Mode B to render the screenshots-and-steps section. Hand-writing it loses the dashboard links the user relies on for review.
- **If the same stage fails 3 times in a row, escalate with details.**
- **If total iterations reach 3 and E2E acceptance tests still fail**, continue to PR creation with `[E2E FAILING]` in the title; the visual walkthrough section makes the failures reviewable.

## Completion contract

The cycle produces two user-facing terminal messages over its lifetime:

**Stage 7 hand-off message** (printed when stage 7 finishes its PR creation):

- PR URL(s)
- E2E status (passing / `[E2E FAILING]`)
- Link to the run dashboard for each test case (via the walkthrough skill output)
- Stage 8 status: either `Watching <N> PR(s) via /loop ...` (dispatched) or `No PRs to watch — stage 8 not dispatched.` (empty manifest)
- Path to `result.md` for full details

**Stage 8 terminating message** (printed when every PR is merged or closed and the loop exits):

- Per-PR final state (merged at `<sha>` / closed without merge)
- Count of items addressed, replied, and escalated per PR
- Path to the updated `result.md`

No other content in either message. The user already read the walkthrough in the PR body and the per-tick log in `followup.log` — do not re-summarize them here.
