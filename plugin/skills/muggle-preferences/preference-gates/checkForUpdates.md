# `checkForUpdates`

Check npm for a newer Muggle version at session start.

**Picker 1** — header `Update check`, question `"Check npm for a newer Muggle version? Requires a network call."`
- `Yes, check` — `Quick network call — flags if you're behind.` → `always`
- `No, skip` — `Skip the check — saves a network call at session start.` → `never`

**Silent action**
- `always` → `Checked for updates`
- `never` → `Skipped update check`
