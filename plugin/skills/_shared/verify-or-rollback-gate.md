# Verify-or-Rollback Gate

The mandatory gate a caller runs after an operation has mutated the working tree and that tree must be proven safe before anything ships — e.g. a resolved rebase onto `origin/{default}`. It verifies the changed surface; on any failure it restores the branch to its pre-mutation state and escalates. The caller hands off the inputs below; this file names no caller — the dependency runs one way.

Contract: never let a mutated tree ship without passing verification, and always keep the branch restorable to its pre-mutation state.

## Inputs

- `pre_rebase_sha` — branch HEAD the caller captured **before** the mutating operation; the rollback point.
- Session context: slug and PR url/number.

## Procedure

### Step 1 — Verify (mandatory)

Each must pass, in order:

1. **Build** — typecheck + lint on the changed surface, run via the caller's build step.
2. **Unit suite** — the caller's unit run; record PASS.

E2E is not a verify step. The mutation replays the branch onto code its own PRs already tested, and a tree held back for a browser run leaves the PR behind or conflicting while the fix waits; the caller runs whatever E2E its cycle owes after the push.

### Step 2 — Pass → proceed

Return success. The caller resumes the normal flow; the push happens downstream, so a mutated tree ships only after its build and unit suite passed.

### Step 3 — Fail → restore + escalate

On any verify failure — or when the caller reports the preceding operation could not complete:

```bash
git reset --hard <pre_rebase_sha>
```

The branch is now byte-for-byte its pre-mutation state. Emit one terminal escalation — the caller's escalation message — naming the failing step, plus the `muggle-do:escalation` event with `kind: "rebase-conflict"` ([`telemetry-events/muggle-do-escalation.md`](telemetry-events/muggle-do-escalation.md)). Do not push.

## Invariants

- A push never follows a verify failure.
- The branch is always restorable to `pre_rebase_sha`.
