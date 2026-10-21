# Fix-CI (watcher-dispatched)

Resolve red CI on a PR's head — lint/format, typecheck, failing unit tests, and a red Muggle E2E walkthrough check — verifying green before re-push. A dumb-pipe dispatch like address-reviews: the executor receives a PR URL, slug, and the failing check names, and fixes them — it owns the fix, not the decision to dispatch.

## Turn preamble

```
**/muggle-do fix-ci** — fixing <count> red check(s) on <owner>/<repo>#<n>.
```

## Input

`$ARGUMENTS` carries a PR/MR URL (`github.com/.../pull/<n>` or `<host>/<group>/<project>/-/merge_requests/<iid>`), `slug=<slug>`, and the failing check names (no review ids). Parse all three. The names are GitHub check-runs or — when the URL resolves `gitlab` per [`../_shared/vcs/detect-vcs.md`](../_shared/vcs/detect-vcs.md) — the failed pipeline-job names the watcher read off [`../_shared/vcs/gitlab/mr-pipeline.md`](../_shared/vcs/gitlab/mr-pipeline.md); the fix cycle below is identical for either.

## Inputs from disk

From `~/.muggle-ai/muggle-do/sessions/<slug>/`: `prs.json` (PR + local checkout / branch), `last_seen.json` (`ci_fix_attempts`, `ci_escalated_shas`, `pushed_shas`), `state.md` (worktree path, validation strategy).

## Procedure

### Step 1 — Re-attach

Check out the PR branch in the session's working tree (per `state.md`). Capture `red_sha = prs.json[0].head_sha`.

### Step 2 — Map each failing check to a local command

Per [`../_shared/ci-check-to-command.md`](../_shared/ci-check-to-command.md). Fix the in-scope checks in the working tree; record out-of-scope checks for escalation (Step 6). A red `muggle-walkthrough` check takes Step 2.5.

### Step 2.5 — Red E2E walkthrough check

1. **Read why.** Fetch the check run's summary per [`../_shared/vcs/github/pr-checks.md`](../_shared/vcs/github/pr-checks.md) and record its `completed_at`. It names every failed or inconclusive case, its failing step, and its run. Take the test case ids from the walkthrough comment's hidden `<!-- muggle-e2e-result:v1 {…} -->` record — the newest comment carrying one.
2. **Repair each case** per [`e2e-repair.md`](e2e-repair.md) Steps 1–3: root-cause to a bucket, then retry, regenerate, or repair the code. This stage is unattended, so a case whose disposition is `ask` is out of scope — record it for Step 6 and never open a picker.
3. **Re-run the whole suite** through [`e2e-acceptance.md`](e2e-acceptance.md) — every test case the walkthrough listed, passing ones included. The walkthrough is replaced wholesale and the check judges all of it, so a re-run scoped to the failures would post a walkthrough that drops the cases that passed.
4. **Order the settle after the push.** If Step 2 changed code, run Steps 3–4 below first, so the new head carries the fix. Then settle the walkthrough comment with the re-run's report via [`../muggle-pr-visual-walkthrough/SKILL.md`](../muggle-pr-visual-walkthrough/SKILL.md) Mode A; editing the comment re-runs the check against the head. With no code change (only retries and regenerations) there is nothing to push — the comment edit alone re-runs the check.
5. **Wait for the fresh verdict** before Step 5's respawn: poll the check run until one completes later than the `completed_at` recorded in item 1, for up to 5 minutes. A watcher respawned sooner reads the stale red verdict and spends a fix attempt on a run already repaired. On timeout, respawn anyway — the per-SHA budget still bounds it.

An empty-comment failure (no run ever posted) skips items 1–2: run the suite and settle the comment. Under a `unit-only` or `skip` validation in `state.md`, settle it with the verified skip code instead.

### Step 3 — Verify before push

- Build (typecheck + lint on the changed surface) + unit suite must pass.
- Run E2E (per [`../muggle-preferences/preference-gates/autoE2ETest.md`](../muggle-preferences/preference-gates/autoE2ETest.md)) only if the fix touched app logic; lint/format-only fixes skip E2E. A Step 2.5 repair always runs the full suite.

A fix that can't be made green locally is not pushed → Step 6.

### Step 4 — Commit + push

Commit per the `fix(ci): <check> — <what>` convention ([`../_shared/pr-followup-helpers/reply-routing.md`](../_shared/pr-followup-helpers/reply-routing.md)). Push. Append the new SHA to `last_seen.pushed_shas`. **No PR replies** — the fix commit is the response.

### Step 5 — Update state + respawn

- Increment `last_seen.ci_fix_attempts[red_sha]` — a whole-file rewrite (Read → change field → Write) per [`../_shared/session-state-writes.md`](../_shared/session-state-writes.md), never the Edit tool.
- Respawn the watcher per [`respawn-watcher.md`](respawn-watcher.md). CI on the new SHA is the verify loop — a still-red SHA returns as a fresh dispatch, bounded by the per-SHA fix budget (Step 6).

### Step 6 — Escalate (budget spent or out of scope)

When the failing checks are all out of scope, or `ci_fix_attempts[red_sha]` has reached 3 with CI still red:

1. Add `red_sha` to `last_seen.ci_escalated_shas` so the SHA is not re-fixed.
2. Emit one terminal message naming the unresolved checks.
3. Emit the cycle event with `outcome: "ci-escalated"` (Step 7).
4. **Respawn the watcher** per [`respawn-watcher.md`](respawn-watcher.md). Escalation stops fix-ci from re-dispatching this SHA — but the poller must keep running: it reminds on the `ci_escalated` block and catches a new push, a new review, or the user's own fix. Skipping respawn here is the silent-stop bug the helper exists to prevent.

### Step 7 — Telemetry

Emit one `muggle-do:cycle` event ([`../_shared/telemetry-events/muggle-do-cycle.md`](../_shared/telemetry-events/muggle-do-cycle.md)): `outcome: "ci-fixed"` when a fix pushed, `"ci-escalated"` when escalated — with `ci_checks_in` / `ci_checks_fixed` / `ci_checks_escalated`.

## Guardrails

- Max 3 fix attempts per SHA; out-of-scope checks escalate immediately rather than churn. A walkthrough repair that pushes nothing keeps the head SHA, so the same budget bounds it.
- No PR replies; the fix commit is the response.
