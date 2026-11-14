# `tasteProfileUpload`

Controls whether `/muggle-taste-profile` uploads the distilled taste profile — a short summary of how the user likes products to look and behave, user-wide and per Muggle project — so Muggle Test runs use it as guidance when they explore and judge. Fires after the profile is built or rebuilt, before `muggle-remote-taste-profile-upload`. The profile is screened for secrets, tokens, private keys, emails and password-like values before it leaves the machine; the raw signal journal never does. A declined profile stays local.

**Picker 1** — header `Taste profile`, question `"Upload your taste profile so test runs judge your app the way you would? It is screened for secrets and emails first, and the raw signals stay on this machine."`
- `Upload it` — `Send the screened profile; you can delete it remotely any time.` → `always`
- `Ask me next time` — `Upload this once and ask again after the next rebuild.` → `ask`
- `Keep it local` — `Never upload; the profile stays on this machine.` → `never`

Both `Upload it` and `Ask me next time` upload this time: call the tool with `hasUserApprovedThisUpload: true`, whatever Picker 2 saves.

**Silent action**
- `always` → `Uploading your screened taste profile`
- `ask` → `Asking before uploading your taste profile`
- `never` → `Keeping your taste profile on this machine`
