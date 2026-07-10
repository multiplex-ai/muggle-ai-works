# Auto-Resolve Rebase Conflicts

The autonomous conflict-resolution body, run when a rebase onto `origin/{default}` reports conflicts **and** [`autoResolveConflicts`](../muggle-preferences/preference-gates/autoResolveConflicts.md) is `always`. Under `never` the caller aborts and escalates instead, and this file never runs. The caller hands off the inputs below; this file names no caller — the dependency runs one way.

Contract: never push an auto-resolved rebase that has not passed the verify gate, and always keep the branch restorable to its pre-rebase state.

## Inputs

- `pre_rebase_sha` — branch HEAD captured by the caller **before** `git rebase`; the rollback point.
- `default` — the branch being rebased onto.
- Session context: slug, PR url/number, and the persisted validation strategy (for the E2E step).

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
- **Semantic** → a reasoned 3-way resolution preserving the intent of **both** sides (ours = the PR's change, theirs = the new default-branch line). If intent in load-bearing logic can't be confidently reconciled, do not guess → Step 5.

Then `git add -A && git rebase --continue`, and repeat Steps 1–2 for each remaining conflicted commit until the rebase completes.

### Step 3 — Verify gate (mandatory)

Each must pass, in order:

1. **Build** — typecheck + lint on the changed surface, run via the caller's build step.
2. **Unit suite** — the caller's unit run; record PASS.
3. **E2E** — the caller's E2E step under the persisted [`autoE2ETest`](../muggle-preferences/preference-gates/autoE2ETest.md) strategy. A poll-only session with no validation context reports `SKIPPED`, same as the normal cycle.

### Step 4 — Pass → proceed

Return success. The caller resumes the normal flow; the push happens downstream, so a resolved rebase ships only after it has verified.

### Step 5 — Fail → restore + escalate

On an unreconcilable semantic conflict (Step 2) or any verify failure (Step 3):

```bash
git rebase --abort 2>/dev/null || true
git reset --hard <pre_rebase_sha>
```

The branch is now byte-for-byte its pre-rebase state. Emit one terminal escalation — the caller's escalation message — naming the conflicted files and the failing step, plus the `muggle-do:escalation` event with `kind: "rebase-conflict"` ([`telemetry-events/muggle-do-escalation.md`](telemetry-events/muggle-do-escalation.md)). Do not push.

## Invariants

- A push never follows a verify failure.
- The branch is always restorable to `pre_rebase_sha`.
- This file runs only under `autoResolveConflicts = always`; `never` is the caller's unchanged abort-and-escalate path.
