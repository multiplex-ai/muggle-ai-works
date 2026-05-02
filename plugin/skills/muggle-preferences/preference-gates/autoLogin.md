# `autoLogin`

Reuse the saved session, or force a fresh login. Substitute `{email}`.

**Picker 1** — header `You're already logged in`, question `"Continue as {email}, or sign in with a different account?"`
- `Continue as me` — `Reuse this session for the rest of this run.` → `always`
- `Switch account` — `Sign out and log in fresh.` → `never`

**Silent action**
- `always` → `Continuing as {email}`
- `never` → `Forcing a fresh login`
