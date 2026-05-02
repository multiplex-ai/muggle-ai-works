# `defaultExecutionMode` (`local` / `remote` / `ask`)

Default place to run tests when the user's request is ambiguous.

**Picker 1** — header `Where to run tests?`, question `"On your computer or in the cloud?"`
- `On my computer` — `Real browser on localhost. Faster feedback while developing.` → `local`
- `In the cloud` — `Muggle's cloud runs against a preview/staging URL.` → `remote`

If the user's intent is already clear (e.g. "test on staging"), skip Picker 1
— confirm with `"Yes, proceed in <mode>"` / `"Switch to <other mode>"` and
skip Picker 2.

**Silent action**
- `local` → `Running on your computer`
- `remote` → `Running in the cloud`
