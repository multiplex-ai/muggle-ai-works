---
name: muggle-do
description: Take a feature request, spec, design, bug, or ticket and carry it autonomously to an opened pull request — write the code, test it, raise the PR. The PR carries real-browser proof: email-gated flows run through live test inboxes, logins through encrypted secrets, and prerequisite flows in test-graph order, with screenshots attached. Use whenever the user wants something built, implemented, added, or fixed with a PR opened, raised, or put up at the end — "implement rate limiting and raise a PR", "build the CSV export and put up a PR", "take this Jira ticket and run with it, ping me when the PR is up", "fix this bug and open a pr", or "muggle do …". Also handles the internal `address-reviews` directive the muggle-pr-followup watcher dispatches when new reviews land. Not for testing or validating existing changes (use muggle-test), nor watching a PR's incoming reviews (use muggle-pr-followup).
mandatoryStages:
  - ../do/input-routing.md
---

# Muggle Test Do

> Telemetry first step: see [`../_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-do"`.

> Running outside Claude Code (in Codex, for one)? Read [`../_shared/host-tool-equivalents.md`](../_shared/host-tool-equivalents.md) first — it maps the tools and paths this skill names to your host's.

Runs an autonomous dev cycle from requirements to PR. **Fire and review:** user answers one pre-flight questionnaire, then walks away. The [muggle-pr-followup](../muggle-pr-followup/SKILL.md) watcher invokes `/muggle-do` again with the *address-reviews* directive when new reviews land.

## Forward pipeline (fresh feature)

| # | Stage | File |
| :- | :---- | :--- |
| 1 | Pre-flight (only user-facing stage) | [`../do/pre-flight.md`](../do/pre-flight.md) |
| 2 | Requirements | [`../do/requirements.md`](../do/requirements.md) |
| 3 | Build | [`../do/build.md`](../do/build.md) |
| 4 | Impact analysis | [`../do/impact-analysis.md`](../do/impact-analysis.md) |
| 5 | Unit tests | [`../do/unit-tests.md`](../do/unit-tests.md) |
| 5.5 | Open PR | [`../do/open-prs.md`](../do/open-prs.md) |
| 6 | E2E acceptance | [`../do/e2e-acceptance.md`](../do/e2e-acceptance.md) |
| 7 | Report on the PR | [`../do/open-prs.md`](../do/open-prs.md) |
| 7.5 | E2E repair loop | [`../do/e2e-repair.md`](../do/e2e-repair.md) |
| 8 | Hand off to watcher | [`../muggle-pr-followup/SKILL.md`](../muggle-pr-followup/SKILL.md) |

**The PR opens before E2E.** Stage 5.5 opens it as soon as unit tests pass; Stage 6 then runs against the PR's head, its progress showing on the PR, and Stage 7 settles the walkthrough with the result. The walkthrough check stays red until then.

**Waves and streams.** A session's PRs are either a **wave** — one change split across repos — or a **stream** of independent changes, or both; [`../do/wave-or-stream.md`](../do/wave-or-stream.md) defines which is which, and pre-flight decides it once.

**Multi-repo waves.** When a task's PRs need each other to work — one PR per repo — they form a wave: every repo's service starts from its branch, Stage 6 runs **one** E2E pass against the combined stack, and that same result is posted to every PR in the wave. See [`../do/wave-e2e.md`](../do/wave-e2e.md); pre-flight decides whether a cycle is a wave.

**Streams — several changes in one session.** Unrelated fixes — several bugs in one request, or a second task while the first is still in flight — are separate changes, each with its own session directory, worktree, PR, and E2E run; a wave is one change among them. When a change reaches Stage 6 while other work is in front of the session, its run goes to a background `acceptance-tester` and the session moves on; the report comes back to the main session, which carries that change through Stages 7–8. One local run at a time, and a PR's walkthrough only ever carries its own change's run. See [`../do/background-e2e.md`](../do/background-e2e.md).

Stage 7 dispatches one watcher per opened PR as its last action, gated on Stage 7.5's clearance — a cycle with unrepaired E2E failures never reaches a watcher.

## Execution protocol (non-negotiable)

The pipeline table lists **pointers, not summaries**. Open each stage's file and execute from it — running a stage off its one-line row here is how tests, E2E, and session state get silently skipped. If you have not read a stage's file this run, you have not run that stage.

**Bootstrap before any code, in order:**
1. Emit telemetry — [`../_shared/telemetry-emit.md`](../_shared/telemetry-emit.md), `skillName: "muggle-do"`.
2. Create `~/.muggle-ai/muggle-do/sessions/<slug>/` with `state.md` + `iterations/001.md` (pre-flight owns this; do it even when running unattended).
3. `TodoWrite` one item per stage 1–8, Stages 5.5 and 7.5 included — these stages are the checklist; never swap in your own decomposition. Several changes → one set of stage items per change.

**Per stage:** read the file → execute it → append one marker line to `iterations/<NNN>.md`, always in the form `Stage <N> done — <evidence>`, citing the evidence that file requires (jest exit code, E2E verdict + `runId`, screenshot path). The marker is the stage's last line, written after its notes, and carries the evidence itself: nothing between `done` and `—`, never a pointer such as `Stage 4 done (see below) —`. A stage is done only when its evidence is written, never on recollection.

### "Autonomous" / "without my intervention" collapses exactly one thing
Best-effort the Stage-1 questionnaire and don't ask. It does **not** license skipping telemetry, session artifacts, requirements, unit tests, E2E (`autoE2ETest` defaults to `always`), browser verification, the gate below, the Stage-7.5 repair loop, or the watcher hand-off. Stage 7.5 investigates and repairs unattended too; only its user decision collapses, into an automatic waive. Run the whole pipeline silently — never a shortcut.

### Definition of Done — gates before Stages 5.5 and 7
Each line holds, or is waived by a one-line reason written into `state.md` (silence is not a waiver).

Before Stage 5.5 opens the PR:
- `requirements.md` written (forward runs)
- Build clean — typecheck + lint on changed files
- New/changed logic carries unit tests (authored in Stage 3; Stage 5 only runs the suite)
- Unit suite run, PASS recorded
- Stage 4's `e2eScope` recorded, mapping every acceptance criterion to a test case, a deliverable check, or `unobservable` — or `not-scoped` with the condition that failed

Before Stage 7 settles the PR's walkthrough:
- A verdict recorded for every deliverable check in that scope
- E2E verdict recorded with `runId` for every case in that scope, per `autoE2ETest` — or `[E2E FAILING]`, or `SKIPPED` citing a verified skip code from [`../do/e2e-acceptance.md`](../do/e2e-acceptance.md), where each code's verification rule lives. Free-text reasons are rejected by the gate
- UI changes verified in a real browser with evidence (screenshot path or muggle `runId`); `curl` + `grep` is not verification

Opening a PR, or settling its walkthrough, with an unchecked, unwaived line of its gate is a cycle failure. A Stage 6 readiness halt ([`../do/e2e-acceptance.md`](../do/e2e-acceptance.md) Step 0.5) leaves the E2E line open: no skip code, waiver, or explicit request to open the PR closes it.

## Address-reviews flow

When invoked with the directive (PR URL + slug + review ids), routes to [`../do/address-reviews.md`](../do/address-reviews.md). Shares stages 3–5 with the forward pipeline, then sizes the cycle from its diff per [`../do/cycle-size.md`](../do/cycle-size.md): a full cycle adds stage 6 and a fresh walkthrough, a minor one skips E2E under a verified `NO_APP_LOGIC_CHANGE`. Skips pre-flight, requirements, and PR creation. See the orchestrator for the cycle's exact step order, classification rules, and respawn logic.

## Input routing

`/muggle-do` serves one interactive mode (the forward pipeline, from a fresh task) and four programmatic modes the watcher dispatches (address-reviews, fix-ci, rebase, post-merge cleanup). Resolve `$ARGUMENTS` to a mode per [`../do/input-routing.md`](../do/input-routing.md) before doing anything else.

## Preferences

| Preference | Gate |
| :--------- | :--- |
| `autoE2ETest` | Stage 6 — run E2E every cycle (default `always`), or fold into pre-flight |
| `autoResolveConflicts` | On rebase conflict — `always` resolves autonomously behind a verify-or-rollback gate, `never` aborts + escalates; resolve from the configured preference (don't assume a default) |
| `autoRouteBuildToMuggleDo` | Front-door guardrail — route build/implement/fix requests through this pipeline (build delegated to superpowers); fired by the UserPromptSubmit guardrail, default `ask` |
| `autoInstallCiWorkflow` | Stage 7 — add the `muggle-walkthrough` CI check to a GitHub repo that lacks it, shipped in the PR; `ask` folds into pre-flight, default `ask`. An unedited copy from an earlier release is refreshed unless `never` |

`autoUseWorktree`, `autoRebase`, `autoResolveConflicts`, `autoCreatePR`, `autoCleanup`, `postPRVisualWalkthrough` fire from per-stage files.

## Session model

`~/.muggle-ai/muggle-do/sessions/<slug>/`. Schemas: [`../muggle-pr-followup/state-schemas.md`](../muggle-pr-followup/state-schemas.md).

| File | Owner |
| :--- | :---- |
| `state.md` | Stage 1 or bootstrap |
| `iterations/<NNN>.md` | Every stage |
| `requirements.md` | Stage 2 (forward only) |
| `prs.json`, `last_seen.json`, `followup.log` | Stage 7 / watcher / `/muggle-do` |
| `result.md` | Stage 5.5 (seeded), terminal tick (finalized) |

## Guardrails

- Stage 1 and Stage 7.5's user decision are the only user-facing forward stages. Stages 2–7 don't ask mid-cycle; blocker → pre-flight bug.
- Same stage failing 3× → escalate.
- Each route's entry file declares the stage files every run of that route opens, and a Stop gate holds the turn until they are read. A turn that ends before its route's last stage — a readiness halt, an escalation, a pause for a background run — records why with `echo "MUGGLE_STAGE_SKIP: <reason>"`.
- 3 repair iterations reach E2E with failures → waive, ship with `[E2E FAILING]`, and hand to the watcher.
- Address-reviews escalation (ambiguous or design-adjustment) does not block the watcher; user resolves on GitHub.
