---
name: muggle-status
description: Use this skill to check the health of the user's Muggle AI installation and diagnose why it's misbehaving — MCP server connectivity, tool loading, login/auth validity, and overall setup. Engage on an explicit "muggle status", but also on any diagnostic question about Muggle itself: "is muggle working / healthy / set up right?", "why does muggle keep failing / timing out / saying it can't connect?", "are the muggle MCP tools actually loading?", "is my muggle login/auth still valid?", "muggle's been acting up — take a look / what's wrong?", "muggle commands fail silently — is the install unhealthy?". This is diagnosis and reporting: prefer it over answering from memory whenever the user is unsure Muggle itself is functioning. Boundary: checking/diagnosing is muggle-status; actually fixing a broken install is muggle-repair (a clear "fix it" goes there). Not for the health of the user's own app, CI, or infrastructure.
---

# Muggle Test Status

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-status"`.

Run a full health check and report results.

## Preferences

Gates run per `preference-gates/README.md`.

| Preference | Step | Decision it gates |
|------------|------|-------------------|
| `checkForUpdates` | Check 4 | Check for newer Muggle Test version |

## Checks

1. **Electron app** — read `~/.muggle-ai/electron-app/` to find the installed version directory. Read `.install-metadata.json` to get version and checksum. Verify the binary exists at the expected path. On macOS, check code signing with `spctl --assess --verbose`.

2. **MCP server** — call `muggle-local-check-status` to verify the server is responsive. Report auth state (authenticated, email, token expiry).

3. **Authentication** — call `muggle-remote-auth-status`. Report whether credentials are valid and when they expire.

4. **CLI version** — gate `checkForUpdates` (per `preference-gates/README.md`):
   - `always` → run the check below.
   - `never` → render the row as `[skip]  check disabled by preference`.
   - `ask` → run Picker 1 from `preference-gates/checkForUpdates.md` via `AskUserQuestion`; map the answer back to one of the actions above.

   When the check runs: capture installed (`muggle --version`) and latest (`npm view @muggleai/works version`). Compare with `sort -V`; flag as out-of-date only when latest is strictly greater.

## Output

```
Muggle AI — Status

Electron app   [pass/fail]  version, binary status
MCP server     [pass/fail]  responsive, auth state
Authentication [pass/fail]  user, expiry
CLI version    [pass/warn]  installed → latest

[All systems operational / Issues found — run /muggle:muggle-repair to fix.]
```

Use pass/fail indicators for each check. If any check fails, tell the user to run `/muggle:muggle-repair`. If the CLI version check warns (installed < latest), tell the user to run `/muggle:muggle-upgrade`.
