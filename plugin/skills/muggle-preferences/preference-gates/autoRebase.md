# `autoRebase`

Rebase onto `origin/{default}` before dev servers / E2E, or run as-is. Substitute `{behind}` and `{default}`.

**Picker 1** — header `Rebase first`, question `"Branch is {behind} commits behind origin/{default} — rebase first?"`
- `Rebase first` — `Pull in default-branch changes so the run reflects the merged main line.` → `always`
- `Run as-is` — `Skip the rebase.` → `never`

**Silent action**
- `always` → `Rebasing onto origin/{default} ({behind} behind)`
- `never` → `Running as-is ({behind} behind origin/{default})`
