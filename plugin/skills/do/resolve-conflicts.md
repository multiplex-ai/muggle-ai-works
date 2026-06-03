# Resolve-Conflicts (watcher-dispatched)

Rebase a PR whose branch conflicts with its base, resolve the conflicts behind a verify-or-rollback gate, and force-push — so a mergeable-blocked PR doesn't sit idle forever. A dumb-pipe dispatch like fix-ci: the watcher detects `mergeable == CONFLICTING` and hands off; the executor owns the rebase + resolution, never the decision to dispatch.

## Turn preamble

```
**/muggle-do resolve-conflicts** — rebasing <owner>/<repo>#<n> onto <base> to clear merge conflicts.
```

## Input

`$ARGUMENTS` carries a `github.com/.../pull/<n>` URL, `slug=<slug>`, and a `resolve conflicts` directive (no review ids, no failing check names). Parse all three.

## Inputs from disk

From `~/.muggle-ai/muggle-do/sessions/<slug>/`: `prs.json` (PR + branch + `head_sha`), `last_seen.json` (`conflict_resolve_attempts`, `conflict_escalated_shas`, `pushed_shas`), `state.md` (worktree path, validation strategy, base branch).

## Procedure

### Step 1 — Re-attach

Materialize the PR branch in its worktree per [`../_shared/pr-branch-worktree.md`](../_shared/pr-branch-worktree.md) (or use `state.md`'s `worktreePath`). Capture `conflict_sha = prs.json[0].head_sha` and the base branch (`baseRefName` from [`../_shared/github-cli-recipes/pr-metadata.md`](../_shared/github-cli-recipes/pr-metadata.md)).

### Step 2 — Rebase onto base + resolve

Run [`../_shared/rebase-before-e2e.md`](../_shared/rebase-before-e2e.md) against the base branch (it fires because a conflicting PR is behind). Conflict handling follows [`autoResolveConflicts`](../muggle-preferences/preference-gates/autoResolveConflicts.md):

- default `never` → abort and escalate per Step 5 (`kind: "rebase-conflict"`). The watcher keeps polling; the user resolves on GitHub, or opts into `autoResolveConflicts=always`.
- `always` → resolve behind the verify-or-rollback gate in [`../_shared/resolve-rebase-conflicts.md`](../_shared/resolve-rebase-conflicts.md).

### Step 3 — Verify the resolution

Build (typecheck + lint on the changed surface) + unit suite must pass. Run E2E per [`e2e-acceptance.md`](e2e-acceptance.md) when app logic changed and the session carries validation context. A resolution that does not verify is rolled back → escalate per Step 5. **Never push an unverified merge.**

### Step 4 — Force-push + respawn

Push with `--force-with-lease` (the rebase rewrote history). Append the new SHA to `last_seen.pushed_shas`; increment `last_seen.conflict_resolve_attempts[conflict_sha]`. Respawn the watcher as the last action:

```
/loop 1m /muggle:muggle-pr-followup <slug> <n>
```

The watcher cancelled its own cron when it dispatched this cycle ([`../muggle-pr-followup/contract.md`](../muggle-pr-followup/contract.md) Step 5b), so this restart is the single live watcher. Its next tick re-checks mergeability on the new head — the rebase is its own verify loop, bounded by the per-SHA attempt budget.

### Step 5 — Escalate (can't resolve / budget spent)

When `autoResolveConflicts=never`, the resolution failed verification, or `conflict_resolve_attempts[conflict_sha]` has reached 2:

1. Add `conflict_sha` to `last_seen.conflict_escalated_shas` so the watcher does not re-dispatch this SHA.
2. Emit one terminal escalation naming the PR and the conflicting files.
3. Respawn the watcher (last action) — it keeps polling for the user's manual resolution or any new reviews.

### Step 6 — Telemetry

Emit one `muggle-do:cycle` event ([`../_shared/telemetry-events/muggle-do-cycle.md`](../_shared/telemetry-events/muggle-do-cycle.md)) with `outcome: "conflicts-resolved"` (a verified rebase pushed) or `"conflicts-escalated"`.

## Guardrails

- Max 2 resolve attempts per SHA; then escalate rather than churn.
- Never push an unverified merge — verify-or-rollback always.
- The default `autoResolveConflicts=never` escalates to the user rather than guessing a merge. Auto-resolution is strictly opt-in.
