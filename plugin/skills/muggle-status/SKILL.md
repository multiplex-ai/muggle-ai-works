---
name: muggle-status
model: haiku
description: "Check the health of the user's Muggle AI installation and diagnose why it's misbehaving — MCP server connectivity, tool loading, login/auth validity, overall setup. Engage on muggle status and on any diagnostic question about Muggle itself: is muggle working or healthy, why does muggle keep failing or timing out, are the muggle MCP tools loading, is my muggle login still valid. Prefer this over answering from memory whenever the user is unsure Muggle itself is functioning. Boundary: diagnosing is muggle-status; fixing a broken install is muggle-repair. Not for the health of the user's own app, CI, or infra."
---

# Muggle Test Status

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-status"`.

Run a full health check and report results.

## Preferences

Gates run per `preference-gates/README.md`.

| Preference | Step | Decision it gates |
|------------|------|-------------------|
| `checkForUpdates` | Check 5 | Check for newer Muggle Test version |

## Checks

1. **Release ring** — run `muggle status` and read its `Runtime target:` and `Backend:` lines. Report the ring and the backend it resolves to.

   This is the first check because it reframes every other one: an install on a non-production ring talks to a different backend, authenticates against a different tenant, and runs a different studio binary, so "is it healthy" cannot be answered without it.

   - `production` → render as `[pass]`.
   - Any other ring → render as `[note]`, not a failure. A staging or dev install is a deliberate state, not a fault, but it must be visible: it is the explanation for auth and backend behaviour that would otherwise look broken.
   - If `MUGGLE_MCP_PROMPT_SERVICE_TARGET` is set in the environment, say so and name its value. It overrides the ring baked in at publish time, it is easy to leave set from an earlier shell, and it explains a ring that disagrees with the installed package.

2. **Electron app** — read `~/.muggle-ai/electron-app/` to find the installed version directory. Non-production rings install to a ring-suffixed directory (`<version>-staging`), so match the directory for the ring reported in Check 1 rather than assuming the bare version — the streams publish the same version deliberately, and the bare directory belongs to production. Read `.install-metadata.json` to get version and checksum. Verify the binary exists at the expected path. On macOS, check code signing with `spctl --assess --verbose`.

3. **MCP server** — call `muggle-local-check-status` to verify the server is responsive. Report auth state (authenticated, email, token expiry).

4. **Authentication** — call `muggle-remote-auth-status`. Report whether credentials are valid and when they expire.

5. **CLI version** — gate `checkForUpdates` (per `preference-gates/README.md`):
   - `always` → run the check below.
   - `never` → render the row as `[skip]  check disabled by preference`.
   - `ask` → run Picker 1 from `preference-gates/checkForUpdates.md` via `AskUserQuestion`; map the answer back to one of the actions above.

   When the check runs: capture installed (`muggle --version`) and latest (`npm view @muggleai/works version`). Compare with `sort -V`; flag as out-of-date only when latest is strictly greater.

## Output

```
Muggle AI — Status

Release ring   [pass/note]  ring, backend URL
Electron app   [pass/fail]  version, binary status
MCP server     [pass/fail]  responsive, auth state
Authentication [pass/fail]  user, expiry
CLI version    [pass/warn]  installed → latest

[All systems operational / Issues found — run /muggle:muggle-repair to fix.]
```

Use pass/fail indicators for each check; the release ring uses `[pass]` on production and `[note]` elsewhere, never `[fail]`. When the ring is not production, state it in the closing line too, so it is not lost in a table the reader skims. If any check fails, tell the user to run `/muggle:muggle-repair`. If the CLI version check warns (installed < latest), tell the user to run `/muggle:muggle-upgrade`.
