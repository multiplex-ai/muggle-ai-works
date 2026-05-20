---
name: muggle-do
description: Unified Muggle AI workflow entry point. Use when user types muggle do or asks for autonomous implementation to PR. Also handles the `address-reviews` directive (dispatched by the muggle-pr-followup watcher when new submitted reviews land on a PR).
disable-model-invocation: true
---

# Muggle Test Do

> Telemetry first step: see [`../_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-do"`.

Runs an autonomous dev cycle from requirements to PR. **Fire and review:** user answers one pre-flight questionnaire, then walks away. The [muggle-pr-followup](../muggle-pr-followup/SKILL.md) watcher invokes `/muggle-do` again with the *address-reviews* directive when new reviews land.

## Forward pipeline (fresh feature)

| # | Stage | File |
| :- | :---- | :--- |
| 1 | Pre-flight (only user-facing stage) | [`../do/pre-flight.md`](../do/pre-flight.md) |
| 2 | Requirements | [`../do/requirements.md`](../do/requirements.md) |
| 3 | Build | [`../do/build.md`](../do/build.md) |
| 4 | Impact analysis | [`../do/impact-analysis.md`](../do/impact-analysis.md) |
| 5 | Unit tests | [`../do/unit-tests.md`](../do/unit-tests.md) |
| 6 | E2E acceptance | [`../do/e2e-acceptance.md`](../do/e2e-acceptance.md) |
| 7 | Create or update PR | [`../do/open-prs.md`](../do/open-prs.md) |
| 8 | Hand off to watcher | [`../muggle-pr-followup/SKILL.md`](../muggle-pr-followup/SKILL.md) |

Stage 7 dispatches one watcher per opened PR as its last action.

## Address-reviews flow

When invoked with the directive (PR URL + slug + review ids), routes to [`../do/address-reviews.md`](../do/address-reviews.md). Shares stages 3–6 + walkthrough with the forward pipeline; skips pre-flight, requirements, and PR creation. See the orchestrator for the cycle's exact step order, classification rules, and respawn logic.

## Input routing

Inspect `$ARGUMENTS` in this order:

1. **Address-reviews** — input contains a `github.com/.../pull/<n>` URL **and** one or more integers ≥ 100000000 (review id shape) → [`../do/address-reviews.md`](../do/address-reviews.md). Programmatic; never ask.
2. **Empty / `help` / `menu` / `?`** → menu + session selector.
3. **Task automation** (perform an action on a website) → `muggle:muggle-do-task`.
4. **Otherwise** → forward pipeline at Stage 1.

When in doubt between #3 and #4, ask one question.

## Preferences

| Preference | Gate |
| :--------- | :--- |
| `autoE2ETest` | Stage 6 — run E2E every cycle (default `always`), or fold into pre-flight |

`autoUseWorktree`, `autoRebase`, `autoCreatePR`, `autoCleanup` fire from per-stage files.

## Session model

`.muggle-do/sessions/<slug>/`. Schemas: [`../muggle-pr-followup/state-schemas.md`](../muggle-pr-followup/state-schemas.md).

| File | Owner |
| :--- | :---- |
| `state.md` | Stage 1 or bootstrap |
| `iterations/<NNN>.md` | Every stage |
| `requirements.md` | Stage 2 (forward only) |
| `prs.json`, `last_seen.json`, `followup.log` | Stage 7 / watcher / `/muggle-do` |
| `result.md` | Stage 7 (seeded), terminal tick (finalized) |

## Guardrails

- Stage 1 is the only user-facing forward stage. Stages 2–7 don't ask mid-cycle; blocker → pre-flight bug.
- Same stage failing 3× → escalate.
- 3 cycle iterations reach E2E with failures → ship with `[E2E FAILING]`.
- Address-reviews escalation (ambiguous or design-adjustment) does not block the watcher; user resolves on GitHub.
