# E2E Repair Loop (Stage 7.5)

Runs between Stage 7's posted walkthrough and Stage 8's watcher dispatch. A failing acceptance run means the change is not ready for a reviewer, so this stage root-causes every failure and either repairs it in-pipeline or puts one decision in front of the user. The watcher is armed only once this stage clears.

## Turn preamble

```
**Stage 7.5 — E2E repair** — root-causing the failing acceptance runs before handing off to the watcher.
```

## Inputs

- The Stage 6 acceptance report from [`e2e-acceptance.md`](e2e-acceptance.md) — its Failed and Inconclusive blocks and the run-level verdict.
- `state.md` — validation strategy, per-repo worktree path, project id.
- The PR opened by [`open-prs/forward.md`](open-prs/forward.md) — repo and number, for the escalation event and the refresh path.
- `repairIteration` — how many times this stage has already run in this session, read from `iterations/<NNN>.md`.

## Step 0: Clearance check

Read the Stage 6 run-level verdict, defined in [`../_shared/failure-mode-handling.md`](../_shared/failure-mode-handling.md) section F.

- `PASS` or `SKIPPED` → nothing to repair. Append `e2e-repair: clear (<verdict>)` to the iteration log and hand to Stage 8.
- A verdict the user waived earlier in this session → clear on the recorded waiver; never re-ask.
- `FAIL`, `PARTIAL`, `INCONCLUSIVE`, or `BLOCKED` → the loop runs over every entry in the Failed and Inconclusive blocks.

## Step 1: Root-cause each failure

Per failing test case, assemble evidence and a diagnosis with [`../_shared/debug-failed-run.md`](../_shared/debug-failed-run.md) Steps 1–2 — attempted steps, halt reason, the failing step's screenshot, then the bucket. That doc's Step 3 is the interactive debug card; this stage is autonomous and does not run it.

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
| `infra` (either) | `ask` | A Muggle Test bug. Nothing in this repo fixes it. |
| `agent-course` (regen) | `ask` | The agent needs steering, which is the user's `muggle-feedback` call to make. |
| `unclassified` | `ask` | No bucket, no automatic action. |

A `repair` disposition requires a named defect: the failing step, expected-versus-actual, and the code path it implicates. Without one it is `ask`, whatever the bucket said.

## Step 3: Act

Process dispositions in order — `retry`, then `regenerate`, then `repair` — so cheap self-healing runs before any code change.

- **`retry`** — re-execute the case unchanged through the Stage 6 loop. Re-bucket the result and fold it back into Step 2.
- **`regenerate`** — regenerate the script for that test case, then re-replay. One regeneration per test case per iteration, matching Stage 6's own cap.
- **`repair`** — re-enter [`build.md`](build.md) with the named defects as this iteration's requirements amendment, then run [`unit-tests.md`](unit-tests.md) and refresh the PR through [`open-prs/update.md`](open-prs/update.md). Impact analysis does not re-run; the change is scoped to a known defect.
- **`ask`** — collect every `ask` failure and present **one** `AskUserQuestion` (Step 4). Never one picker per failure.

## Step 4: The user decision

One question, listing each unrepairable failure with its bucket, failing step, and dashboard link. Options:

1. **Repair anyway** — the user names what the fix should be; the loop treats it as a `repair` disposition and re-enters Step 3.
2. **Give feedback and rerun** — invoke `muggle-feedback` for the run, then re-execute in regen mode. The right answer for `agent-course`.
3. **Waive and ship** — record the waiver in `state.md`, retitle the PR `[E2E FAILING]`, and clear to Stage 8.
4. **Stop here** — leave the PR open and unwatched; the user takes it from there.

**Unattended runs.** When the cycle was started autonomously there is nobody to ask. Do not skip the loop — run Steps 1–3 in full, then treat a surviving `ask` as an automatic waive: emit the escalation event, retitle `[E2E FAILING]`, and clear to Stage 8. Silently arming the watcher on a red run is the failure this stage exists to prevent.

## Step 5: Close the loop

After a `repair`, `regenerate`, or `retry` pass, re-run [`e2e-acceptance.md`](e2e-acceptance.md) over the affected test cases only, increment `repairIteration`, and return to Step 0.

The loop is bounded at **3** repair iterations, the same bound the cycle guardrail already applies to E2E failures. On the third exhausted iteration, waive automatically: retitle `[E2E FAILING]`, record the surviving failures in `result.md`, and clear to Stage 8. A PR a reviewer can see is worth more than a loop that never terminates.

## Telemetry

Steps 1–3 emit the `*-classified` / `*-resolved` pair per [`../_shared/failure-mode-handling.md`](../_shared/failure-mode-handling.md) section D, with `userAction` set to the disposition this stage took (`repair`, `regenerate`, `retry`) rather than a human pick. A failure that reaches Step 4 records the user's actual choice.

Every waive — user-picked, unattended, or iteration-capped — also emits `muggle-do:escalation` with `kind: "e2e-unrepairable"` per [`../_shared/telemetry-events/muggle-do-escalation.md`](../_shared/telemetry-events/muggle-do-escalation.md).

## Output

**Verdict in:** `<Stage 6 verdict>`
**Repair iterations:** `<n>` of 3
**Repaired:** test case → root cause → commit subject
**Regenerated:** test case → new script id
**Waived:** test case → bucket → reason
**Verdict out:** `<verdict after the final re-run>`
**Clearance:** `green` | `waived — <reason>` | `iteration-cap`

## Invariants

- Stage 8 is unreachable while clearance is unresolved — the only exits are green, waived, or iteration-capped.
- No bucket auto-repairs without a named defect.
- One `AskUserQuestion` per stage run, never one per failure.
- An unattended run still executes Steps 1–3; only Step 4 collapses.
- Re-runs are scoped to the affected test cases, never the whole suite.
