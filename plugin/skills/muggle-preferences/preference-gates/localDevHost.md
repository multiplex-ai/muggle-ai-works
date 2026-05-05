# `localDevHost`

Reuse the saved local dev server URL for this repo, or pick one each run. Substitute `{lastHost}` (the URL used in the previous run for this repo — omit the option entirely when no cache exists) and `{suggestedHost}` (auto-detected from running ports, e.g. `http://localhost:3000`).

Cache lives at `<cwd>/.muggle-ai/last-host.json`. The calling skill **always** updates the cache after the user picks/types a URL — independent of Picker 2 — so `Use {lastHost}` reflects the most recent run.

**Picker 1** — header `Local server`, question `"Which local URL should the test target?"`
- `Use {lastHost}` — `From your last run in this repo.` → reuse cached URL. *Skip this option when no cache exists.*
- `Use {suggestedHost}` — `Detected from a port that's running.` → use the suggestion
- `Type a URL` — `Paste any URL.` → calling skill prompts for free-text input

**Picker 2 — overrides shared template.** Fires after the user picks a URL.
- Header `Remember this URL?`, question `"Always use {chosenHost} for this repo from now on, without asking?"`
- `Yes, always` (sub: `You can change this later in muggle preferences.`) → `muggle-local-preferences-set` (`localDevHost=always`, global). The cache is already up to date.
- `Just this once` (sub: `I'll ask again next time.`) → don't save the preference. The cache still updates.

**Silent action**
- `always` (cache used) → `Using saved local URL {lastHost}`
- `never` → no footer; the picker is the visible step.
