# `autoResolveConflicts`

When a rebase onto `origin/{default}` hits conflicts, resolve them autonomously behind a verify-or-rollback gate, or stop and escalate. Default `never` — the loop aborts the rebase and escalates exactly as before. Opt in with `always` to resolve conflicts without a human.

**Picker 1** — header `Resolve rebase conflicts?`, question `"Rebase onto origin/{default} hit conflicts in {conflicted} file(s) — resolve them autonomously?"`
- `Resolve autonomously` — `Resolve the conflicts, then re-verify (build + unit + E2E) before any push; roll back and escalate if verification fails.` → `always`
- `Stop and escalate` — `Abort the rebase, restore the branch, and hand the conflict to me.` → `never`

**Silent action**
- `always` → `Resolving rebase conflicts autonomously (verify-or-rollback)`
- `never` → `Aborting rebase and escalating — conflicts in {conflicted} file(s)`
