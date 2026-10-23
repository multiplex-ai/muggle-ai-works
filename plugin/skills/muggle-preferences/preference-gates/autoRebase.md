# `autoRebase`

Sync onto `origin/{base}` before dev servers / E2E and before a push, without asking. Stale code is never tested: before a dev server or E2E run, not rebasing stops the run. Substitute `{behind}` and `{base}`.

**Picker 1** — header `Rebase first`, question `"Branch is {behind} commits behind origin/{base} — rebase first?"`
- `Rebase first` — `Pull in the base branch's changes so the run reflects the merged main line.` → `always`
- `Don't rebase` — `Leave the branch as it is. A dev server or E2E run stops instead of testing stale code; a push goes ahead.` → `never`

**Silent action**
- `always` → `Rebasing onto origin/{base} ({behind} behind)`
- `never` → `Not rebasing ({behind} behind origin/{base}) — a dev server or E2E run stops here`
