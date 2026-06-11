# Fix-CI (watcher-dispatched)

Resolve red CI on a PR's head — lint/format, typecheck, and failing unit tests — verifying green before re-push. A dumb-pipe dispatch like address-reviews: the executor receives a PR URL, slug, and the failing check names, and fixes them — it owns the fix, not the decision to dispatch.

## Turn preamble

```
**/muggle-do fix-ci** — fixing <count> red check(s) on <owner>/<repo>#<n>.
```

## Input

`$ARGUMENTS` carries a PR/MR URL (`github.com/.../pull/<n>` or `<host>/<group>/<project>/-/merge_requests/<iid>`), `slug=<slug>`, and the failing check names (no review ids). Parse all three. The names are GitHub check-runs or — when the URL resolves `gitlab` per [`../_shared/detect-vcs.md`](../_shared/detect-vcs.md) — the failed pipeline-job names the watcher read off [`../_shared/gitlab-cli-recipes/mr-pipeline.md`](../_shared/gitlab-cli-recipes/mr-pipeline.md); the fix cycle below is identical for either.

## Inputs from disk

From `~/.muggle-ai/muggle-do/sessions/<slug>/`: `prs.json` (PR + local checkout / branch), `last_seen.json` (`ci_fix_attempts`, `ci_escalated_shas`, `pushed_shas`), `state.md` (worktree path, validation strategy).

## Procedure

### Step 1 — Re-attach

Check out the PR branch in the session's working tree (per `state.md`). Capture `red_sha = prs.json[0].head_sha`.

### Step 2 — Map each failing check to a local command

Per [`../_shared/ci-check-to-command.md`](../_shared/ci-check-to-command.md). Fix the in-scope checks in the working tree; record out-of-scope checks for escalation (Step 6).

### Step 3 — Verify before push

- Build (typecheck + lint on the changed surface) + unit suite must pass.
- Run E2E (per [`../muggle-preferences/preference-gates/autoE2ETest.md`](../muggle-preferences/preference-gates/autoE2ETest.md)) only if the fix touched app logic; lint/format-only fixes skip E2E.

A fix that can't be made green locally is not pushed → Step 6.

### Step 4 — Commit + push

Commit per the `fix(ci): <check> — <what>` convention ([`../_shared/pr-followup-helpers/reply-routing.md`](../_shared/pr-followup-helpers/reply-routing.md)). Push. Append the new SHA to `last_seen.pushed_shas`. **No PR replies** — the fix commit is the response.

### Step 5 — Update state + respawn

- Increment `last_seen.ci_fix_attempts[red_sha]`.
- Respawn the watcher: `/loop 1m /muggle:muggle-pr-followup <slug> <n>`. The watcher cancelled its own cron when it dispatched this fix-ci cycle ([`../muggle-pr-followup/contract.md`](../muggle-pr-followup/contract.md) Step 5), so this restart is the single live watcher. CI on the new SHA is the verify loop — a still-red SHA returns as a fresh dispatch, bounded by the per-SHA fix budget (Step 6).

### Step 6 — Escalate (budget spent or out of scope)

When the failing checks are all out of scope, or `ci_fix_attempts[red_sha]` has reached 3 with CI still red:

1. Add `red_sha` to `last_seen.ci_escalated_shas` so the SHA is not re-fixed.
2. Emit one terminal message naming the unresolved checks.
3. Emit the cycle event with `outcome: "ci-escalated"` (Step 7). Do not loop further on this SHA.

### Step 7 — Telemetry

Emit one `muggle-do:cycle` event ([`../_shared/telemetry-events/muggle-do-cycle.md`](../_shared/telemetry-events/muggle-do-cycle.md)): `outcome: "ci-fixed"` when a fix pushed, `"ci-escalated"` when escalated — with `ci_checks_in` / `ci_checks_fixed` / `ci_checks_escalated`.

## Guardrails

- Max 3 fix attempts per SHA; out-of-scope checks escalate immediately rather than churn.
- No PR replies; the fix commit is the response.
