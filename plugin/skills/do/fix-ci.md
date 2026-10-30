---
mandatoryStages:
  - ../_shared/session-state-writes.md
  - respawn-watcher.md
  - ../_shared/telemetry-events/muggle-do-cycle.md
---

# Fix-CI (watcher-dispatched)

Resolve red CI on a PR's head — lint/format, typecheck, failing unit tests, and a red Muggle E2E walkthrough check — verifying green before re-push. A dumb-pipe dispatch like address-reviews: the executor receives a PR URL, slug, and the failing check names, and fixes them — it owns the fix, not the decision to dispatch.

## Turn preamble

```
**/muggle-do fix-ci** — fixing <count> red check(s) on <owner>/<repo>#<n>.
```

## Input

`$ARGUMENTS` carries a PR/MR URL (`github.com/.../pull/<n>` or `<host>/<group>/<project>/-/merge_requests/<iid>`), `slug=<slug>`, and the failing check names (no review ids). Parse all three. The names are GitHub check-runs or — when the URL resolves `gitlab` per [`../_shared/vcs/detect-vcs.md`](../_shared/vcs/detect-vcs.md) — the failed pipeline-job names the watcher read off [`../_shared/vcs/gitlab/mr-pipeline.md`](../_shared/vcs/gitlab/mr-pipeline.md); the fix cycle below is identical for either.

## Inputs from disk

From `~/.muggle-ai/muggle-do/sessions/<slug>/`: `prs.json` (PR + local checkout / branch), `last_seen.json` (`ci_fix_attempts`, `ci_escalated_shas`, `ci_rerun_shas`, `pushed_shas`), `state.md` (worktree path, validation strategy).

## Procedure

### Step 1 — Re-attach

Check out the PR branch in the session's working tree (per `state.md`). Capture `red_sha = prs.json[0].head_sha` — this cycle's `pre_cycle_sha` ([`cycle-size.md`](cycle-size.md)).

Then increment `last_seen.ci_fix_attempts[red_sha]` — before any fix, re-run or escalation, as a whole-file rewrite (Read → change field → Write) per [`../_shared/session-state-writes.md`](../_shared/session-state-writes.md), never the Edit tool. Every dispatched cycle is an attempt, including one that only re-runs a check or escalates without pushing. That count is the only record the watcher and its turn-end gate accept that this red head was acted on; an escalation written without it is ignored and fix-ci is dispatched again ([`../muggle-pr-followup/state-schemas.md`](../muggle-pr-followup/state-schemas.md#last_seenjson)).

The increment opens a cycle this turn carries through Step 5 or Step 6 — it never stands in for one. The single exception is a red `muggle-walkthrough` whose E2E run for **this** PR is already queued or running (its `state.md` shows `E2E dispatch: queued` or `running`): that run is the cycle, and its report settles the comment. Writing the count for a PR with no such run, or because another PR's run is in flight, clears the turn-end gate while the PR stays red; the watch never asks again until the head moves, and the PR can merge red.

### Step 2 — Map each failing check to a local command

Per [`../_shared/ci-check-to-command.md`](../_shared/ci-check-to-command.md). Fix the in-scope checks in the working tree; record out-of-scope checks for escalation (Step 6). A red `muggle-walkthrough` check takes Step 2.5; a red non-deterministic check takes Step 2.6.

How long a check takes to run — a 45-minute eval included — is never a reason to skip, defer or escalate it. A held fix needs the user's own words: a message they typed containing `HOLD WATCH #<pr-number>`.

### Step 2.5 — Red E2E walkthrough check

1. **Read why.** Fetch the check run's summary per [`../_shared/vcs/github/pr-checks.md`](../_shared/vcs/github/pr-checks.md) and record its `completed_at`. It names every failed or inconclusive case, its failing step, and its run. Take the test case ids from the walkthrough comment's hidden `<!-- muggle-e2e-result:v1 {…} -->` record — the newest comment carrying one.
2. **Repair each case** per [`e2e-repair.md`](e2e-repair.md) Steps 1–3: root-cause to a bucket, then retry, regenerate, or repair the code. This stage is unattended, so a case whose disposition is `ask` is out of scope — record it for Step 6 and never open a picker.
3. **Re-run the whole suite** through [`e2e-acceptance.md`](e2e-acceptance.md) — every test case the walkthrough listed, passing ones included. The walkthrough is replaced wholesale and the check judges all of it, so a re-run scoped to the failures would post a walkthrough that drops the cases that passed.
4. **Order the settle after the push.** If Step 2 changed code, run Steps 3–4 below first, so the new head carries the fix. Then settle the walkthrough comment with the re-run's report via [`../muggle-pr-visual-walkthrough/SKILL.md`](../muggle-pr-visual-walkthrough/SKILL.md) Mode A; editing the comment re-runs the check against the head. With no code change (only retries and regenerations) there is nothing to push — the comment edit alone re-runs the check.
5. **Wait for the fresh verdict** before Step 5's respawn: poll the check run until one completes later than the `completed_at` recorded in item 1, for up to 5 minutes. A watcher respawned sooner reads the stale red verdict and spends a fix attempt on a run already repaired. On timeout, respawn anyway — the per-SHA budget still bounds it.

An empty-comment failure (no run ever posted) skips items 1–2. Pick the branch from `state.md`:

- **`local-e2e` or `staging-replay`** → run the suite and settle the comment with its report.
- **`unit-only`, `skip`, or no `## Pre-flight answers` block at all** (a poll-only session — auto-track, or bootstrap on a PR it found no testable surface for) → settle it with the skip code that holds per [`e2e-acceptance.md`](e2e-acceptance.md): `NO_WEB_SURFACE` when the repo serves nothing to drive, `NO_APP_LOGIC_CHANGE` (detail opening with the PR's merge-base commit) when every path the PR changed is docs, tests, lint or CI config, else `NOT_APPLICABLE` with the reason no browser run can reach the change. Run `echo "MUGGLE_E2E_SKIP: <CODE>: <detail>"` from the PR's working tree. The write runs detached, so confirm it landed: run the foreground command the walkthrough gate's block names until it prints `{"settled":true}`, never a hand-written PATCH. Never `NO_PR`: the guardrail refutes it whenever the session handled a PR.
- **A poll-only PR whose change a browser run *can* reach** → no code holds, so do not cite one. Escalate per Step 6, naming the missing E2E decision; the owner chooses run, project or waive.

`muggle-walkthrough` is never a Step 2.6 check: it reads the comment, so re-running it without editing the comment returns the same verdict.

### Step 2.6 — Red non-deterministic check: re-run once per head

A check whose verdict can change with nothing changed — an LLM-judged eval gate such as `skill-routing-eval`, `skill-gate-eval` or `agent-gate-eval` — gets one automatic re-run per head before anything escalates:

- **A deterministic check is also red and in scope** → skip the re-run. Fix that check (Steps 3–4); the push re-runs every check on the new head.
- **`red_sha` ∉ `last_seen.ci_rerun_shas`** → re-run the failed jobs of each such check's run, without pushing — the run id is the `/actions/runs/<run-id>/` segment of the check's `link` ([`../_shared/vcs/github/pr-checks.md`](../_shared/vcs/github/pr-checks.md)):
  ```bash
  gh run rerun <run-id> --failed --repo <owner>/<repo>
  ```
  GitLab retries the failed job instead ([`../_shared/vcs/gitlab/mr-pipeline.md`](../_shared/vcs/gitlab/mr-pipeline.md)). Append `red_sha` to `last_seen.ci_rerun_shas` (whole-file rewrite), skip Steps 3–4, and go to Step 5. The attempt was counted in Step 1; the watcher wakes on the re-run's verdict like any other.
- **`red_sha` ∈ `ci_rerun_shas`** — it already had its re-run and failed again → escalate per Step 6.

### Step 3 — Verify before push

- Build (typecheck + lint on the changed surface) + unit suite must pass.
- Size the fix per [`cycle-size.md`](cycle-size.md) with `pre_cycle_sha = red_sha`. A full fix runs E2E before the push; a minor one skips it and declares `NO_APP_LOGIC_CHANGE` after Step 4's push. A lint or format fix that edits a source file is full. A Step 2.5 repair always runs the full suite.

A fix that can't be made green locally is not pushed → Step 6.

### Step 4 — Commit + push

Commit per the `fix(ci): <check> — <what>` convention ([`../_shared/pr-followup-helpers/reply-routing.md`](../_shared/pr-followup-helpers/reply-routing.md)). Push. Append the new SHA to `last_seen.pushed_shas`. Then finish the tail [`cycle-size.md`](cycle-size.md) picked: a full fix reposts the walkthrough (a Step 2.5 repair settles it there instead), a minor one declares the skip. **No PR replies** — the fix commit is the response.

### Step 5 — Respawn

Respawn the watcher per [`respawn-watcher.md`](respawn-watcher.md). CI on the new SHA — or the re-run's fresh verdict on the same one — is the verify loop: a still-red SHA returns as a fresh dispatch, bounded by the per-SHA fix budget (Step 6).

### Step 6 — Escalate (budget spent or out of scope)

When the failing checks are all out of scope, a non-deterministic check is red again after its re-run on this head (Step 2.6), or this is the head's third cycle (`ci_fix_attempts[red_sha]` reached 3 in Step 1) and it could not push a fix:

1. Add `red_sha` to `last_seen.ci_escalated_shas` so the SHA is not re-fixed. This cycle's Step 1 attempt is what makes the entry count.
2. Emit one terminal message naming the unresolved checks.
3. Emit the cycle event with `outcome: "ci-escalated"` (Step 7).
4. **Respawn the watcher** per [`respawn-watcher.md`](respawn-watcher.md). Escalation stops fix-ci from re-dispatching this SHA — but the poller must keep running: it reminds on the `ci_escalated` block and catches a new push, a new review, or the user's own fix. Skipping respawn here is the silent-stop bug the helper exists to prevent.

### Step 7 — Telemetry

Emit one `muggle-do:cycle` event ([`../_shared/telemetry-events/muggle-do-cycle.md`](../_shared/telemetry-events/muggle-do-cycle.md)): `outcome: "ci-fixed"` when a fix pushed, `"ci-escalated"` when escalated — with `ci_checks_in` / `ci_checks_fixed` / `ci_checks_escalated`.

## Guardrails

- Max 3 fix attempts per SHA; out-of-scope checks escalate immediately rather than churn. A walkthrough repair or a re-run that pushes nothing keeps the head SHA, so the same budget bounds it.
- A non-deterministic check is re-run once per head before it escalates — never escalated on its first red, never re-run twice on one head.
- No PR replies; the fix commit is the response.
