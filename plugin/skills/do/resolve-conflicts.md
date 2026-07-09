# Rebase (watcher-dispatched)

Rebase a PR's branch onto its base — whether it's merely **behind** (out of date, no conflict) or actually **conflicting** — behind a verify-or-rollback gate, then force-push, so a PR doesn't sit stale or un-mergeable forever. A dumb-pipe dispatch like fix-ci: the watcher detects the branch is behind or conflicting and hands off; the executor owns the rebase (and any conflict resolution), never the decision to dispatch.

## Turn preamble

```
**/muggle-do rebase** — rebasing <owner>/<repo>#<n> onto <base> to bring the branch up to date.
```

## Input

`$ARGUMENTS` carries a `github.com/.../pull/<n>` URL, `slug=<slug>`, and a `rebase` directive (no review ids, no failing check names). Parse all three.

## Inputs from disk

From `~/.muggle-ai/muggle-do/sessions/<slug>/`: `prs.json` (PR + branch + `head_sha`), `last_seen.json` (`conflict_resolve_attempts`, `conflict_escalated_shas`, `pushed_shas`), `state.md` (worktree path, validation strategy, base branch).

## Procedure

### Step 1 — Re-attach

Materialize the PR branch in its worktree per [`../_shared/pr-branch-worktree.md`](../_shared/pr-branch-worktree.md) (or use `state.md`'s `worktreePath`). Capture `rebase_sha = prs.json[0].head_sha` and the base branch (`baseRefName` from [`../_shared/vcs/github/pr-metadata.md`](../_shared/vcs/github/pr-metadata.md)).

### Step 2 — Rebase onto base (resolve conflicts if any)

Run the rebase from [`../_shared/rebase-before-e2e.md`](../_shared/rebase-before-e2e.md) against the base branch, taking its `always` path unconditionally — this programmatic mode never asks, so skip the `autoRebase` prompt (the watcher already decided a rebase is due).

- **Clean replay** — a behind-only branch (and any rebase that hits no conflicts) replays without intervention. Proceed to Step 3.
- **Conflicts** — handle per [`autoResolveConflicts`](../muggle-preferences/preference-gates/autoResolveConflicts.md):
  - `never` → abort and escalate per Step 5 (`kind: "rebase-conflict"`). The watcher keeps polling; the user resolves on GitHub.
  - `always` → resolve behind the verify-or-rollback gate in [`../_shared/resolve-rebase-conflicts.md`](../_shared/resolve-rebase-conflicts.md).

### Step 3 — Verify the resolution

Build (typecheck + lint on the changed surface) + unit suite must pass. Run E2E per [`e2e-acceptance.md`](e2e-acceptance.md) when app logic changed and the session carries validation context. A rebase that does not verify is rolled back → escalate per Step 5. **Never push an unverified rebase.**

### Step 4 — Force-push + respawn

Push with `--force-with-lease` (the rebase rewrote history). Append the new SHA to `last_seen.pushed_shas`; increment `last_seen.conflict_resolve_attempts[rebase_sha]` — both whole-file rewrites (Read → change field → Write) per [`../_shared/session-state-writes.md`](../_shared/session-state-writes.md), never the Edit tool. Respawn the watcher per [`respawn-watcher.md`](respawn-watcher.md). Its next tick re-checks the branch against its base on the new head — the rebase is its own verify loop, bounded by the per-SHA attempt budget.

### Step 5 — Escalate (can't resolve / budget spent)

When `autoResolveConflicts=never`, the resolution failed verification, or `conflict_resolve_attempts[rebase_sha]` has reached 2:

1. Add `rebase_sha` to `last_seen.conflict_escalated_shas` so the watcher does not re-dispatch this SHA.
2. Emit one terminal escalation naming the PR and the conflicting files (or the failing verification, for a behind-only rebase that didn't verify).
3. Respawn the watcher per [`respawn-watcher.md`](respawn-watcher.md) — it keeps polling for the user's manual resolution or any new reviews.

### Step 6 — Telemetry

Emit one `muggle-do:cycle` event ([`../_shared/telemetry-events/muggle-do-cycle.md`](../_shared/telemetry-events/muggle-do-cycle.md)) with `outcome: "rebased"` (a verified rebase pushed — behind-only or conflicts resolved) or `"rebase-escalated"`.

## Guardrails

- Max 2 rebase attempts per SHA; then escalate rather than churn.
- Never push an unverified rebase — verify-or-rollback always.
- Resolve `autoResolveConflicts` from the configured preference (per the gate contract — don't assume a default): `always` resolves conflicts behind the verify-or-rollback gate, `never` escalates to the user. A clean behind-only rebase needs neither.
