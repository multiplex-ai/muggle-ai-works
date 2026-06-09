# Debug a Failed Run — Shared Reference

> Presentation layer for a single failed run. Turns one non-passing terminal run — local or remote — into a debug path: **evidence → diagnosis → a guaranteed user choice that always offers "give feedback & rerun".** Used by `muggle-test` (Step 7C), `muggle-test-feature-local`, and the `muggle-do` e2e stage. Depends on [`failure-mode-handling.md`](./failure-mode-handling.md) for the bucket taxonomy and telemetry schema — never the reverse. Don't restate its tables; read them.

## The guarantee

Every non-passing terminal run MUST route through this doc before it is reported. A failure is never summarized-and-dropped: the user is always shown *what happened* and is always presented a selection in which **"give feedback & rerun" is a first-class option**. "Skip — just report" stays selectable but is never the default.

The guarantee binds **interactive** callers. An autonomous caller with no user to prompt (the `acceptance-tester` agent) runs Steps 1–2 (evidence + diagnosis into its structured report) and skips Step 3's interactive offer.

## Inputs (the caller passes these in)

- `runId` (local) or workflow runtime id (remote).
- `mode` — `replay` or `regen`, the mode that failed.
- `testCaseId`, `projectId`.
- A re-execute handle — the loop/tool the caller used to run this case, so a rerun re-enters the same execution path.

## Step 1 — Gather evidence

Read **structured run fields**, never the `execute` stdout tail (see [`dev-loop/failures.md`](./dev-loop/failures.md)). Assemble:

- **Attempted steps + reasoning** — local: the attempted steps + `summaryStep` halt reason from `action-script.json` in `artifactsDir`; remote: the per-step list + `summaryStep` from `muggle-remote-wf-get-ts-gen-latest-run` / `muggle-remote-wf-get-ts-replay-latest-run`.
- **Visual evidence** — a failed run already preserves the full step-by-step on disk: every per-step frame under `<artifactsDir>/electron-runtime/screenshot/` (with per-step label data under `.../dataset/`), alongside the step script at `<artifactsDir>/action-script.json`. `run-result-get` returns `artifactsDir` — read the whole set there; don't trust a step's `screenshotLocalPath`, which points at the original runtime dir. Once published — failed runs are published too, see [`dev-loop/publish.md`](./dev-loop/publish.md) — the same frames are cloud-hosted per step as `screenshotUrl`, the form remote runs expose directly.
- **Verdict** — `Status` + `Error`.

## Step 2 — Diagnose

Classify into the failure bucket per [`failure-mode-handling.md`](./failure-mode-handling.md) — §B for a replay failure, §C for a regen failure. That bucket **is** the initial diagnosis. Phrase it for a human ("Looks like a **stale script** — the selectors moved; the product itself probably still works"), not as a telemetry label. Emit the `replay-failure-classified` / `regen-failure-classified` event now, before presenting anything.

## Step 3 — Present the debug card, then the guaranteed offer

Show the **debug card** first: attempted steps + reasoning, the failing step's screenshot (or a one-line note if a path is genuinely absent), and the one-line diagnosis.

Then present one `AskUserQuestion` whose options are:

1. **Give feedback & rerun** — always present. Invoke the `muggle-feedback` skill with this run's anchor (`runId` local / `testScriptId` remote) so the user says what should have happened, then re-execute per Step 4.
2. **The bucket's recommended action** from §B/§C (regenerate, report bug, share defect, retry…). Label it `(Recommended)` — it is the classifier's pick.
3. **Retry as-is**.
4. **Skip — just report** — last, never the default.

The bucket's recommended action and its alternatives live in `failure-mode-handling.md` §B/§C — read them there, don't restate them.

**Feedback anchor by lane.** Feedback attaches to a cloud action-script id. `muggle-feedback` owns resolving it: for a **local** run it publishes/uploads first when the run isn't already published; for a **remote** run it uses the existing script. Pass `runId` (local) or `testScriptId` (remote) and let it resolve the anchor — don't resolve or upload here.

## Step 4 — Rerun (always regen)

On "give feedback & rerun": once `muggle-feedback` returns, re-execute the test case in **regen** mode — feedback adjusts the agent's course, so the prior script is discarded; replay is never the rerun path. Local: the regen branch of [`dev-loop/run.md`](./dev-loop/run.md). Remote: `muggle-remote-workflow-start-test-script-generation`. Read the new run's result back through this doc (Step 1) so a second failure is debugged too.

## Step 5 — Resolve

Emit the `replay-failure-resolved` / `regen-failure-resolved` event with `userAction` set to the pick (`feedback-rerun`, the bucket action, `retry`, or `skip`) — one `*-classified` and one `*-resolved` per failure, per [`failure-mode-handling.md`](./failure-mode-handling.md) §D.

Process failures one at a time so the user isn't drowning in pickers.
