# Fix-CI (watcher-dispatched)

Resolve red CI on a PR's head — lint/format, typecheck, and failing unit tests — verifying green before re-push. Invoked by the [`muggle-pr-followup`](../muggle-pr-followup/contract.md) watcher (Step 5) when a tick sees failing checks and the fix budget for that SHA isn't spent. Like address-reviews, this is a dumb-pipe dispatch: the watcher detects, this stage fixes.

## Turn preamble

```
**/muggle-do fix-ci** — fixing <count> red check(s) on <owner>/<repo>#<n>.
```

## Input

`$ARGUMENTS` carries a `github.com/.../pull/<n>` URL, `slug=<slug>`, and the failing check names (no review ids). Parse all three.

## Inputs from disk

From `~/.muggle-ai/muggle-do/sessions/<slug>/`: `prs.json` (PR + local checkout / branch), `last_seen.json` (`ci_fix_attempts`, `ci_escalated_shas`, `pushed_shas`), `state.md` (worktree path, validation strategy).

## Procedure

### Step 1 — Re-attach

Check out the PR branch in the session's working tree (per `state.md`). Capture `red_sha = prs.json[0].head_sha`.

### Step 2 — Map each failing check to a local command

Read the repo's `package.json` scripts (repo-agnostic — never hardcode script names). For each failing check:

- **lint / format** → run the repo's lint `--fix` / formatter; restage.
- **typecheck** → run the typecheck script; read errors; edit types.
- **unit / test** → run the suite; read failures; fix the code or the test.
- **Out of scope** — E2E-in-CI, build/deploy infra, flaky / non-deterministic, or unknown → do **not** attempt; record for escalation (Step 6).

### Step 3 — Verify before push

- Build (typecheck + lint on the changed surface) + unit suite must pass.
- Run E2E (per [`../muggle-preferences/preference-gates/autoE2ETest.md`](../muggle-preferences/preference-gates/autoE2ETest.md)) only if the fix touched app logic; lint/format-only fixes skip E2E.

A fix that can't be made green locally is not pushed → Step 6.

### Step 4 — Commit + push

Commit per the `fix(ci): <check> — <what>` convention ([`../_shared/pr-followup-helpers/reply-routing.md`](../_shared/pr-followup-helpers/reply-routing.md)). Push. Append the new SHA to `last_seen.pushed_shas`. **No PR replies** — the fix commit is the response.

### Step 5 — Update state + respawn

- Increment `last_seen.ci_fix_attempts[red_sha]`.
- Respawn the watcher (`/loop 1m /muggle:muggle-pr-followup <slug> <n>`). The next tick re-checks CI on the new SHA — CI is the verify loop. If still red and `ci_fix_attempts[sha] < 3`, the watcher re-dispatches; once attempts reach 3 or only out-of-scope checks remain, escalate (Step 6).

### Step 6 — Escalate (budget spent or out of scope)

When the failing checks are all out of scope, or `ci_fix_attempts[red_sha]` has reached 3 with CI still red:

1. Add `red_sha` to `last_seen.ci_escalated_shas` so the watcher stops re-dispatching it.
2. Emit one terminal message naming the unresolved checks.
3. Emit the cycle event with `outcome: "ci-escalated"` (Step 7). Do not loop further on this SHA.

### Step 7 — Telemetry

Emit one `muggle-do:cycle` event ([`../_shared/telemetry-events/muggle-do-cycle.md`](../_shared/telemetry-events/muggle-do-cycle.md)): `outcome: "ci-fixed"` when a fix pushed, `"ci-escalated"` when escalated — with `ci_checks_in` / `ci_checks_fixed` / `ci_checks_escalated`.

## Guardrails

- Max 3 fix attempts per SHA; out-of-scope checks escalate immediately rather than churn.
- A review landing always wins a tick over CI (watcher Step 4 precedes Step 5).
- No PR replies; the fix commit is the response.
