# `checkForUpdates`

Check npm daily for a newer Muggle Test version on the installed release lane, and remind at session start and on every skill call. `never` stops the check and the reminders; `ask` still reminds, since a reminder asks nothing.

**Picker 1** — header `Update check`, question `"Check for a newer Muggle Test version (one quick network call)?"`
- `Check now` — `Flags if you're behind.` → `always`
- `Skip check` — `No version check, no upgrade reminders.` → `never`

**Silent action**
- `always` → `Checked for updates`
- `never` → `Skipped update check`
