# `autoRebase`

Sync onto `origin/{base}` before dev servers / E2E and before a push, or run as-is. Substitute `{behind}` and `{base}`.

**Picker 1** — header `Rebase first`, question `"Branch is {behind} commits behind origin/{base} — rebase first?"`
- `Rebase first` — `Pull in the base branch's changes so the run reflects the merged main line.` → `always`
- `Run as-is` — `Skip the rebase.` → `never`

**Silent action**
- `always` → `Rebasing onto origin/{base} ({behind} behind)`
- `never` → `Running as-is ({behind} behind origin/{base})`
