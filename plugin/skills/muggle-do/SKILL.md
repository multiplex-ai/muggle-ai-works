---
name: muggle-do
description: Unified Muggle AI workflow entry point. Use when user types muggle do or asks for autonomous implementation to PR.
disable-model-invocation: true
---

# Muggle Test Do

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-do"`.

Runs an autonomous dev cycle from requirements to PR. **Fire and review:** the user answers one pre-flight questionnaire, then walks away.

For maintenance, use the dedicated skills:

- `/muggle:muggle-status`
- `/muggle:muggle-repair`
- `/muggle:muggle-upgrade`

## The pipeline

| # | Stage | File | User-facing? |
| :- | :---- | :--- | :----------- |
| 1 | Pre-flight | [../do/pre-flight.md](../do/pre-flight.md) | **Yes — one consolidated turn** |
| 2 | Requirements | [../do/requirements.md](../do/requirements.md) | No |
| 3 | Build | [../do/build.md](../do/build.md) | No |
| 4 | Impact analysis | [../do/impact-analysis.md](../do/impact-analysis.md) | No |
| 5 | Unit tests | [../do/unit-tests.md](../do/unit-tests.md) | No |
| 6 | E2E acceptance | [../do/e2e-acceptance.md](../do/e2e-acceptance.md) | No |
| 7 | Open PR | [../do/open-prs.md](../do/open-prs.md) | No |
| 8 | PR follow-up | [../muggle-pr-followup/SKILL.md](../muggle-pr-followup/SKILL.md) (generic) — invoked with muggle-do's cycle declaration | **Yes — only on ambiguous reviews** |

Stage 1 talks to the user once. Stages 2–7 run silently. Stage 7 dispatches **one Stage-8 follow-up loop per PR** it opens (not one per session); each loop polls its own PR independently for new submitted reviews. When a review lands, the loop cycles back through Stage 3 (Build) → 4 → 5 → 6 → fresh visual walkthrough → push to the existing branch, then resumes polling for the next round. Each loop may escalate once on an ambiguous review.

**Each stage's file is the single source of truth for that stage** — definition, contract, inputs/outputs, preference gates, output format. Read each stage file directly for its rules. This file is only the orchestration spine.

## Preferences

| Preference | Stage | Decision it gates |
|------------|-------|-------------------|
| `autoE2ETest` | 6 (E2E acceptance) | Run E2E every cycle (default `always`), or fold the question into pre-flight |

Other gates that fire during this cycle (`autoUseWorktree`, `autoRebase`, `autoCreatePR`, `autoCleanup`) are owned by the per-stage files; see each stage for its contract.

## Input routing

Treat `$ARGUMENTS` as the user command:

- Empty / `help` / `menu` / `?` → show menu and session selector.
- Anything else → infer intent:
  - **Task automation** (perform an action on a website — post something, fill a form, click through a flow) → invoke `muggle:muggle-do-task` with the full prompt.
  - **Feature development** (build / fix / refactor code) → start or resume a dev-cycle session.

When in doubt, ask one question: "Browser automation task, or code change?"

## Session model

Every run writes to `.muggle-do/sessions/<slug>/`. Stages own the files they produce:

| File | Owned by | Purpose |
| :--- | :------- | :------ |
| `state.md` | Stage 1 (rewritten by every transition) | Current stage, pre-flight answers, blockers |
| `iterations/<NNN>.md` | Every stage | Append-only stage transition log |
| `requirements.md` | Stage 2 | Frozen requirements |
| `prs.json`, `last_seen.json`, `followup.log` | Stage 8 | See [`pr-followup.md`](../do/pr-followup.md) |
| `result.md` | Stage 7 (seeded), Stage 8 (finalized) | Per-PR final state |

## Guardrails

- **Stage 1 is the only forward-pipeline user-facing stage.** Stages 2–7 don't ask questions mid-cycle. If a stage hits a blocker pre-flight didn't cover, treat as a pre-flight bug — escalate once and expand `pre-flight.md` after the run.
- **Stage 8 may escalate** once per ambiguous review comment, and may dispatch back to Stage 3 when needed — see [`pr-followup.md`](../do/pr-followup.md).
- **If the same stage fails 3 times in a row, escalate** with details.
- **If 3 cycle iterations reach E2E with failures**, ship with `[E2E FAILING]` per [`open-prs.md`](../do/open-prs.md). The walkthrough section keeps the failures reviewable.
