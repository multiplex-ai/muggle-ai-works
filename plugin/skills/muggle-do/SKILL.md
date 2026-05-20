---
name: muggle-do
description: Unified Muggle AI workflow entry point. Use when user types muggle do or asks for autonomous implementation to PR. Also handles the `address-reviews` directive (dispatched by the muggle-pr-followup watcher when new submitted reviews land on a PR).
disable-model-invocation: true
---

# Muggle Test Do

> Telemetry first step: see [`../_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-do"`.

Runs an autonomous dev cycle from requirements to PR. **Fire and review:** the user answers one pre-flight questionnaire, then walks away. For PRs already open, the [muggle-pr-followup](../muggle-pr-followup/SKILL.md) watcher dispatches `/muggle-do` again with an *address-reviews* directive whenever new submitted reviews land; that path skips pre-flight and reads the reviews as amended requirements.

For maintenance, use the dedicated skills:

- `/muggle:muggle-status`
- `/muggle:muggle-repair`
- `/muggle:muggle-upgrade`

## The forward pipeline (fresh feature)

| # | Stage | File | User-facing? |
| :- | :---- | :--- | :----------- |
| 1 | Pre-flight | [../do/pre-flight.md](../do/pre-flight.md) | **Yes — one consolidated turn** |
| 2 | Requirements | [../do/requirements.md](../do/requirements.md) | No |
| 3 | Build | [../do/build.md](../do/build.md) | No |
| 4 | Impact analysis | [../do/impact-analysis.md](../do/impact-analysis.md) | No |
| 5 | Unit tests | [../do/unit-tests.md](../do/unit-tests.md) | No |
| 6 | E2E acceptance | [../do/e2e-acceptance.md](../do/e2e-acceptance.md) | No |
| 7 | Create or update PR | [../do/open-prs.md](../do/open-prs.md) | No |
| 8 | Hand off to watcher | [../muggle-pr-followup/SKILL.md](../muggle-pr-followup/SKILL.md) | No |

Stage 1 talks to the user once. Stages 2–7 run silently. Stage 7 dispatches **one watcher per opened PR** as its last action. The watcher is a dumb pipe — it polls for new reviews and dispatches `/muggle-do` again when there are any. No cycle iteration inside the watcher; no `cycle.json` or `requirements.md` seeded into the session slot.

## The address-reviews flow

When `/muggle-do` is invoked with an *address-reviews* directive (PR URL + slug + one or more review ids), it runs a parallel orchestration via [`../do/address-reviews.md`](../do/address-reviews.md):

| Stage | What runs |
| :---- | :-------- |
| Read reviews | Fetch from GitHub by id |
| Classify | actionable vs ambiguous, per [`../_shared/pr-followup-helpers.md`](../_shared/pr-followup-helpers.md) |
| Ambiguous | One terminal escalation message; advance cursor past them; respawn watcher |
| Actionable (one or more) | Build → Unit tests → ONE E2E pass → Create-or-update PR → Per-comment inline replies → Resolve-reminder |
| Always | Update cursor + `pushed_shas[]`; respawn watcher unless PR went terminal |

The flow shares stages 3–6 + the walkthrough with the forward pipeline. It does **not** run pre-flight, requirements gathering, or PR creation — the PR exists, and the reviews ARE the requirements amendment.

**Each stage's file is the single source of truth for that stage** — definition, contract, inputs/outputs, preference gates, output format. Read each stage file directly for its rules. This file is only the orchestration spine.

## Preferences

| Preference | Stage | Decision it gates |
|------------|-------|-------------------|
| `autoE2ETest` | 6 (E2E acceptance) | Run E2E every cycle (default `always`), or fold the question into pre-flight |

Other gates that fire during this cycle (`autoUseWorktree`, `autoRebase`, `autoCreatePR`, `autoCleanup`) are owned by the per-stage files; see each stage for its contract.

## Input routing

Treat `$ARGUMENTS` as the user (or skill) command. Inspect for shape in this order:

1. **Address-reviews directive** — text mentions one or more review ids together with a PR URL and a session slug. Common shape: `address reviews <id1> <id2> ... on <pr-url> slug=<slug>`. Loose matching is fine — if the input contains a github.com/.../pull/<n> URL **and** at least one integer that looks like a review id (≥ 100000000), route to [`../do/address-reviews.md`](../do/address-reviews.md). Typical caller: the watcher loop's tick contract.
2. **Empty / `help` / `menu` / `?`** → show menu and session selector.
3. **Feature development** (build / fix / refactor code) — anything else that's not a task-automation phrase → start or resume a forward-pipeline dev-cycle session at Stage 1.
4. **Task automation** (perform an action on a website — post something, fill a form, click through a flow) → invoke `muggle:muggle-do-task` with the full prompt.

When in doubt between feature development and task automation, ask one question: "Browser automation task, or code change?" Never ask if the address-reviews shape matched — that path is purely programmatic.

## Session model

Every run writes to `.muggle-do/sessions/<slug>/`. Stages own the files they produce:

| File | Owned by | Purpose |
| :--- | :------- | :------ |
| `state.md` | Stage 1 (forward) / bootstrap (followup) | Current stage, pre-flight answers, blockers, cached loop-user |
| `iterations/<NNN>.md` | Every stage | Append-only stage transition log |
| `requirements.md` | Stage 2 (forward pipeline only) | Frozen requirements for fresh features. Not written by the address-reviews flow. |
| `prs.json` | Stage 7 (forward) or bootstrap | One entry per PR — see [`../muggle-pr-followup/state-schemas.md`](../muggle-pr-followup/state-schemas.md#prsjson) |
| `last_seen.json` | Stage 7 (seeded), watcher + `/muggle-do` (updated) | Cursor + counters + `pushed_shas[]` + `escalated_review_ids[]` — see [`../muggle-pr-followup/state-schemas.md`](../muggle-pr-followup/state-schemas.md#last_seenjson) |
| `followup.log` | Watcher + `/muggle-do` | Append-only tick + cycle log |
| `result.md` | Stage 7 (seeded), watcher or `/muggle-do` (finalized on terminal state) | Per-PR final state |

**Not present in the slot:** `cycle.json` (no longer used — the watcher does not iterate a declared cycle). The forward pipeline's `requirements.md` lives in the slot for fresh features but is not consumed by the address-reviews flow.

## Guardrails

- **Stage 1 is the only forward-pipeline user-facing stage.** Stages 2–7 don't ask questions mid-cycle. If a stage hits a blocker pre-flight didn't cover, treat as a pre-flight bug — escalate once and expand `pre-flight.md` after the run.
- **The address-reviews flow** may escalate via the ambiguous-review path or the design-adjustment path — see [`../do/address-reviews.md`](../do/address-reviews.md#step-3--handle-ambiguous-if-any). Escalation does not block the watcher from respawning; the user resolves on GitHub.
- **If the same stage fails 3 times in a row, escalate** with details.
- **If 3 cycle iterations reach E2E with failures**, ship with `[E2E FAILING]` per [`../do/open-prs.md`](../do/open-prs.md). The walkthrough section keeps the failures reviewable.
