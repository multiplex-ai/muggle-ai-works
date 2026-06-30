# `autoResolveConflicts`

When a rebase onto `origin/{default}` hits conflicts, `always` resolves them autonomously behind a verify-or-rollback gate and `never` aborts the rebase and escalates. Take the effective value from the configured preference per [`../README.md`](../README.md#resolution) (the injected `Muggle Test Preferences` line) — don't assume a default; an unset key resolves to `ask`.

**Picker 1** — header `Resolve rebase conflicts?`, question `"Rebase onto origin/{default} hit conflicts in {conflicted} file(s) — resolve them autonomously?"`
- `Resolve autonomously` — `Resolve the conflicts, then re-verify (build + unit + E2E) before any push; roll back and escalate if verification fails.` → `always`
- `Stop and escalate` — `Abort the rebase, restore the branch, and hand the conflict to me.` → `never`

**Silent action**
- `always` → `Resolving rebase conflicts autonomously (verify-or-rollback)`
- `never` → `Aborting rebase and escalating — conflicts in {conflicted} file(s)`
