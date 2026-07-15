# Resolve Rebase Conflicts

How to resolve the conflicts a rebase onto `origin/{default}` reports, when [`autoResolveConflicts`](../muggle-preferences/preference-gates/autoResolveConflicts.md) is `always`. Under `never` the caller aborts and escalates instead, and this file never runs. The caller hands off the inputs below and, once resolution completes, runs the [`verify-or-rollback-gate.md`](verify-or-rollback-gate.md) before anything ships. This file names no caller — the dependency runs one way.

Contract: resolve deterministically where the change is mechanical, reason about intent where it is semantic, and never guess in load-bearing logic — hand an unreconcilable conflict back to the caller rather than fabricating a merge.

## Inputs

- `pre_rebase_sha` — branch HEAD captured by the caller **before** `git rebase`; the caller passes it on to the verify-or-rollback gate as the rollback point.
- `default` — the branch being rebased onto.

## Procedure

### Step 1 — Enumerate and classify conflicts

```bash
git diff --name-only --diff-filter=U
```

Classify each conflicted path:

- **Mechanical** — lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, …), generated output (`dist/`, build artifacts, snapshots), or pure formatting / import-order churn.
- **Semantic** — anything carrying logic: source, behavior-changing config, tests.

### Step 2 — Resolve

- **Mechanical** → resolve deterministically: regenerate the lockfile with the repo's package manager; regenerate or take-incoming for generated files; run the repo's formatter. Never hand-merge a lockfile.
- **Semantic** → a reasoned 3-way resolution preserving the intent of **both** sides (ours = the PR's change, theirs = the new default-branch line). If intent in load-bearing logic can't be confidently reconciled, do not guess: `git rebase --abort` and hand the unreconcilable paths back to the caller, which restores `pre_rebase_sha` and escalates via the verify-or-rollback gate.

Then `git add -A && git rebase --continue`, and repeat Steps 1–2 for each remaining conflicted commit until the rebase completes. On success, return to the caller, which runs the verify-or-rollback gate before the resolved tree ships.

## Invariants

- Never fabricate a merge in load-bearing logic; an unreconcilable conflict goes back to the caller.
- This file resolves; it does not verify or push. The [`verify-or-rollback-gate.md`](verify-or-rollback-gate.md) owns the ship-or-rollback decision.
- Runs only under `autoResolveConflicts = always`; `never` is the caller's unchanged abort-and-escalate path.
