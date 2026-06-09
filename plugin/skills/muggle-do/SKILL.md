---
name: muggle-do
description: Unified Muggle AI workflow entry point. Use to take a feature request, spec, design, bug, or ticket and carry it all the way to a pull request autonomously — write the code, test it, and open the PR with little further input. Trigger whenever the user wants something built, implemented, added, or fixed and a PR opened, raised, or put up at the end, e.g. "implement rate limiting and raise a PR", "build the CSV export button and put up a PR", "take this Figma/Jira ticket and run with it, ping me when the PR is up", "fix this bug and open a pr", or simply "muggle do …". The signal is a build/implement/fix request paired with opening a PR, handed off for hands-off execution. Also handles the internal `address-reviews` directive dispatched by the muggle-pr-followup watcher when new reviews land on a PR. Not for testing or validating code the user already wrote (use muggle-test), and not for ongoing watching of a PR's incoming reviews (use muggle-pr-followup).
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

## Execution protocol (non-negotiable)

The pipeline table lists **pointers, not summaries**. Open each stage's file and execute from it — running a stage off its one-line row here is how tests, E2E, and session state get silently skipped. If you have not read a stage's file this run, you have not run that stage.

**Bootstrap before any code, in order:**
1. Emit telemetry — [`../_shared/telemetry-emit.md`](../_shared/telemetry-emit.md), `skillName: "muggle-do"`.
2. Create `~/.muggle-ai/muggle-do/sessions/<slug>/` with `state.md` + `iterations/001.md` (pre-flight owns this; do it even when running unattended).
3. `TodoWrite` one item per stage 1–8 — these stages are the checklist; never swap in your own decomposition.

**Per stage:** read the file → execute it → append a marker to `iterations/<NNN>.md` citing the evidence that file requires (jest exit code, E2E verdict + `runId`, screenshot path). A stage is done only when its evidence is written, never on recollection.

### "Autonomous" / "without my intervention" collapses exactly one thing
Best-effort the Stage-1 questionnaire and don't ask. It does **not** license skipping telemetry, session artifacts, requirements, unit tests, E2E (`autoE2ETest` defaults to `always`), browser verification, the gate below, or the watcher hand-off. Run the whole pipeline silently — never a shortcut.

### Definition of Done — gate before Stage 7
Do not create or update a PR until each line holds, or is waived by a one-line reason written into `state.md` (silence is not a waiver):
- `requirements.md` written (forward runs)
- Build clean — typecheck + lint on changed files
- New/changed logic carries unit tests (authored in Stage 3; Stage 5 only runs the suite)
- Unit suite run, PASS recorded
- E2E verdict recorded with `runId` per `autoE2ETest` — or `[E2E FAILING]` / `SKIPPED` + reason
- UI changes verified in a real browser with evidence (screenshot path or muggle `runId`); `curl` + `grep` is not verification

Opening a PR with an unchecked, unwaived line is a cycle failure.

## Address-reviews flow

When invoked with the directive (PR URL + slug + review ids), routes to [`../do/address-reviews.md`](../do/address-reviews.md). Shares stages 3–6 + walkthrough with the forward pipeline; skips pre-flight, requirements, and PR creation. See the orchestrator for the cycle's exact step order, classification rules, and respawn logic.

## Input routing

`/muggle-do` serves one interactive mode (the forward pipeline, from a fresh task) and four programmatic modes the watcher dispatches (address-reviews, fix-ci, rebase, post-merge cleanup). Resolve `$ARGUMENTS` to a mode per [`../do/input-routing.md`](../do/input-routing.md) before doing anything else.

## Preferences

| Preference | Gate |
| :--------- | :--- |
| `autoE2ETest` | Stage 6 — run E2E every cycle (default `always`), or fold into pre-flight |
| `autoResolveConflicts` | On rebase conflict — resolve autonomously behind a verify-or-rollback gate (opt-in), or abort + escalate (default `never`) |
| `autoRouteBuildToMuggleDo` | Front-door guardrail — route build/implement/fix requests through this pipeline (build delegated to superpowers); fired by the UserPromptSubmit guardrail, default `ask` |

`autoUseWorktree`, `autoRebase`, `autoResolveConflicts`, `autoCreatePR`, `autoCleanup` fire from per-stage files.

## Session model

`~/.muggle-ai/muggle-do/sessions/<slug>/`. Schemas: [`../muggle-pr-followup/state-schemas.md`](../muggle-pr-followup/state-schemas.md).

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
