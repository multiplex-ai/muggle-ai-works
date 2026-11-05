# E2E Repair Loop (Stage 7.5)

Runs between Stage 7's posted walkthrough and Stage 8's watcher dispatch, and again whenever the watcher finds the PR's `muggle-walkthrough` check red on failed cases ([`fix-ci.md`](fix-ci.md) Step 2.5). A failing acceptance run means the change is not ready for a reviewer, so this stage root-causes every failure and either repairs it in-pipeline or puts one decision in front of the user. The watcher is armed only once this stage clears.

## Turn preamble

```
**Stage 7.5 — E2E repair** — root-causing the failing acceptance runs before handing off to the watcher.
```

## Inputs

- The Stage 6 acceptance report from [`e2e-acceptance.md`](e2e-acceptance.md) — its Failed and Inconclusive blocks and the run-level verdict.
- `state.md` — validation strategy, per-repo worktree path, project id.
- The PR opened by [`open-prs/forward.md`](open-prs/forward.md) — repo and number, for the escalation event and the refresh path.
- `repairIteration` — how many times this stage has already run in this session, read from `iterations/<NNN>.md`.

Entered from fix-ci, the failing cases come from the red check instead of a Stage 6 report: the check run's summary (each failed or inconclusive case, its failing step, its run link) and the walkthrough comment's hidden `muggle-e2e-result` record (the same cases with their test case ids). The run-level verdict is `FAIL` when any case failed, else `INCONCLUSIVE`. A walkthrough settled by a `NO_APP_LOGIC_CHANGE` skip keeps the last full run beneath it, record included; those failures are this head's and enter the loop like any other.

## Wave cycles

`state.md` records `Wave: on` → the loop runs once for the wave per [`wave-e2e.md`](wave-e2e.md): repairs land in each failure's `implicatedRepo` (`unknown` is `ask`), re-runs use the wave stack, and every wave PR's walkthrough and title are refreshed after each pass.

## Step 0: Clearance check

Read the Stage 6 run-level verdict, defined in [`../_shared/failure-mode-handling.md`](../_shared/failure-mode-handling.md) section F.

- `PASS` or `SKIPPED` → nothing to repair. Append `e2e-repair: clear (<verdict>)` to the iteration log and hand to Stage 8.
- A verdict the user waived earlier in this session → clear on the recorded waiver; never re-ask.
- An entry whose run failed because the app did not answer — connection refused, page never loaded — is the readiness halt of [`e2e-acceptance.md`](e2e-acceptance.md) Step 0.5 arriving late. Nothing ran, so there is nothing to repair and nothing to waive, attended or not: re-check readiness there, and if the app is still down, stop as Step 4's **Stop here** and report the halt. A run the runner lost while the app answers — an Electron, MCP or Studio crash, even before the first step — is not this: it is an `infra` failure and takes the loop below.
- `FAIL`, `PARTIAL`, `INCONCLUSIVE`, or `BLOCKED` → the loop runs over every entry in the Failed and Inconclusive blocks, and every non-`PASS` entry in the Deliverables block.

## Step 1: Root-cause each failure

Per failing test case, assemble evidence and a diagnosis with [`../_shared/debug-failed-run.md`](../_shared/debug-failed-run.md) Steps 1–2 — attempted steps, halt reason, the failing step's screenshot, then the bucket. For a local run that is one `muggle-local-run-steps-get` call. That doc's Step 3 is the interactive debug card; this stage is autonomous and does not run it.

Check the steps against the verdict before repairing anything. A run whose frames show the element its verdict calls missing is a false negative — repairing working code against one wastes the cycle.

Stage 6 already wrote this evidence into its Failed block. Re-derive a bucket only for entries that arrived without one.

The bucket is the root cause. Anything that does not land in a bucket is `unclassified` — never force-fit one to reach an auto-repair disposition.

## Step 2: Disposition

Map each bucket to exactly one disposition. Buckets are defined in [`../_shared/failure-mode-handling.md`](../_shared/failure-mode-handling.md) sections B and C.

| Bucket | Disposition | Why |
| :----- | :---------- | :-- |
| `product-defect` (replay) | `repair` | The change broke a flow that used to work. That is this pipeline's own bug to fix. |
| `product-uxux` (regen) | `repair` | The product blocks the agent because the feature does not work. |
| `stale-script` (replay) | `regenerate` | Selectors moved; the product is fine. Regenerating is self-healing, not a code change. |
| `transient` (regen) | `retry` | Once, then re-bucket the second result. A twice-transient failure is `infra`. |
| `test-precondition` (either) | `repair-test` | The product is right for the data it has; the test asserts on state it never created. Repair the test case, never the product. |
| `infra` (either) | `ask` | A Muggle Test bug. Nothing in this repo fixes it. |
| `agent-course` (regen) | `ask` | The agent needs steering, which is the user's `muggle-feedback` call to make. |
| `unclassified` | `ask` | No bucket, no automatic action. |

A `repair` disposition requires a named defect: the failing step, expected-versus-actual, and the code path it implicates. A `repair-test` disposition requires one too: the asserted state, the evidence the account lacks it (the frame, the record list), and the test-case change that would create it. Without one either is `ask`, whatever the bucket said.

**A failure the diff cannot explain may predate it.** When a `product-defect` or `product-uxux` failure names no code path the diff touched, replay the same test case against a checkout of the base before repairing anything: a worktree at the base tip's full SHA, with its own stack claim and services, under the same runSettings record. A change to the Studio itself needs a Studio build whose release manifest names a commit on the base: the run records that commit, and a build that names none cannot be credited. If that run fails the same way, its disposition is `baseline` — the defect is on the base, not this change's to fix — and the entry carries that run's id as `baselineRunId` into the walkthrough report ([`../muggle-pr-visual-walkthrough/e2e-report-assembly.md`](../muggle-pr-visual-walkthrough/e2e-report-assembly.md)). If it passes, the change caused the failure and the original disposition stands. A `baseline` entry is never re-run or waived; when every remaining failure is `baseline`, the loop clears.

A Deliverables entry carries no bucket. A `FAIL` entry is already a named defect — the failed probe or review with its expected and observed values — so its disposition is `repair`. An `INCONCLUSIVE` entry is `ask`, naming its reason: a missing tool or unreachable source is the machine's to fix, not the diff's. A Step 5 re-run re-checks only the deliverable entries the repair touched.

An Inconclusive entry Stage 6 recorded as `prerequisites unmet` never executed. It carries no bucket and none may be derived from it — there is no run to read. Its disposition is `ask`, and the question names the missing prerequisite: what failed is the project's test-plan chain, not the diff.

An Inconclusive entry Stage 6 recorded as `primary failed` never executed either: it is a record held back by its test case's failed primary. It takes no disposition of its own; the primary's entry is the one repaired, and re-running the test case runs it again.

## Step 3: Act

Process dispositions in order — `retry`, then `regenerate`, then `repair-test`, then `repair` — so cheap self-healing runs before any code change.

- **`retry`** — re-execute the case unchanged through the Stage 6 loop. Re-bucket the result and fold it back into Step 2.
- **`regenerate`** — regenerate the script for that test case, then re-replay. One regeneration per test case per iteration, matching Stage 6's own cap.
- **`repair-test`** — update the test case with `muggle-remote-test-case-update` so it produces the state it asserts on: a setup step that creates the record, a seeded precondition, or a prerequisite test case it chains after. Keep the assertion as written — an edit that stops checking the behavior is not a repair. Then regenerate its script and re-run. No product code changes, so nothing is pushed.
- **`repair`** — re-enter [`build.md`](build.md) with the named defects as this iteration's requirements amendment, then run [`unit-tests.md`](unit-tests.md) and refresh the PR through [`open-prs/update.md`](open-prs/update.md). Impact analysis does not re-run; the change is scoped to a known defect.
- **`ask`** — collect every `ask` failure and present **one** `AskUserQuestion` (Step 4). Never one picker per failure.

## Step 4: The user decision

One question, listing each unrepairable failure with its bucket, failing step, and dashboard link. Options — the same four in every form the decision takes:

1. **Repair anyway** — the user names what the fix should be; the loop treats it as a `repair` disposition and re-enters Step 3.
2. **Give feedback and rerun** — invoke `muggle-feedback` for the run, then re-execute in regen mode. The right answer for `agent-course`.
3. **Waive and ship** — record `E2E waived: <test case ids> — <the user's words>` in `state.md`, retitle the PR `[E2E FAILING]`, and clear to Stage 8. Only the user's own pick or words waive. The walkthrough check stays red on the posted run; merging past it is the user's call.
4. **Stop here** — leave the PR open and unwatched; the user takes it from there.

A case `state.md` already records as waived never reaches the question again.

**Unattended runs.** When the cycle was started autonomously there is nobody to ask, and nobody's waiver to record. Do not skip the loop — run Steps 1–3 in full, then leave a surviving `ask` as an **open decision**, never a waiver:

1. Write the decision into `state.md`, replacing any earlier one:
   ```
   ## E2E decision
   - Head: <head sha>
   - <test case name> (<test case id>) — <bucket> — step <n>: <what failed> — <run link>
   - Options: repair with direction | feedback and rerun | waive | stop
   ```
2. Retitle the PR `[E2E FAILING]` and emit the escalation event.
3. End the turn's final message with the decision request — one line per case naming its bucket, then the four options.
4. Clear to Stage 8 as `decision-pending`. The armed watcher sees the walkthrough check red, fix-ci finds this decision for the head and escalates without repeating the repair, and the watcher's blocked reminder carries the cases and options until the user answers.

A readiness halt (Step 0) is not an `ask` and never becomes a decision. Silently arming the watcher on a red run, or waiving one nobody looked at, is the failure this stage exists to prevent.

Entered from fix-ci, Step 4 always takes the unattended form, and fix-ci's escalation ([`fix-ci.md`](fix-ci.md) Step 6) stands in for the Stage 8 clearance.

The user's answer — to the question, or to the decision request after it was printed — runs that option over the listed cases and removes the `## E2E decision` block.

## Step 5: Close the loop

After a `repair`, `repair-test`, `regenerate`, or `retry` pass, re-run [`e2e-acceptance.md`](e2e-acceptance.md) over the affected test cases only, increment `repairIteration`, and return to Step 0. A change whose `state.md` records `E2E lane: background` re-runs through that lane ([`background-e2e.md`](background-e2e.md)), queued behind any local run in flight, with this PR's URL in the brief.

The loop is bounded at **3** repair iterations, the same bound the cycle guardrail already applies to E2E failures. On the third exhausted iteration, the surviving failures go to Step 4 as `ask`, each with its last bucket — the question when attended, the open decision when not.

## Telemetry

Steps 1–3 emit the `*-classified` / `*-resolved` pair per [`../_shared/failure-mode-handling.md`](../_shared/failure-mode-handling.md) section D, with `userAction` set to the disposition this stage took (`repair`, `repair-test`, `regenerate`, `retry`) rather than a human pick. A failure that reaches Step 4 records the user's actual choice.

Every waive the user picked, and every open decision left for them, also emits `muggle-do:escalation` with `kind: "e2e-unrepairable"` per [`../_shared/telemetry-events/muggle-do-escalation.md`](../_shared/telemetry-events/muggle-do-escalation.md).

## Output

**Verdict in:** `<Stage 6 verdict>`
**Repair iterations:** `<n>` of 3
**Repaired:** test case → root cause → commit subject
**Test repaired:** test case → missing precondition → test-case change
**Regenerated:** test case → new script id
**Waived:** test case → bucket → the user's words
**Decision pending:** test case → bucket → failing step
**Verdict out:** `<verdict after the final re-run>`
**Clearance:** `green` | `waived — <reason>` | `decision-pending`

## Invariants

- Stage 8 is unreachable while clearance is unresolved — the only exits are green, waived by the user, or decision-pending.
- No waiver without the user's own pick or words; an unattended run or a spent iteration budget leaves a decision, never a waiver.
- No bucket auto-repairs without a named defect; `repair-test` changes the test case, never product code.
- One `AskUserQuestion` per stage run, never one per failure.
- An unattended run still executes Steps 1–3; only Step 4 collapses.
- Re-runs are scoped to the affected test cases, except when entered from fix-ci: the walkthrough is replaced wholesale, so that re-run covers the whole suite.
