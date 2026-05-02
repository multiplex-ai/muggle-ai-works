---
name: muggle-status
description: Check health of the Muggle AI installation. Use when user types muggle status, asks for Muggle health, MCP health, or auth validity.
---

# Muggle Status

Run a full health check and report results.

## Preferences

Gates run per `preference-gates/GATE.md`.

| Preference | Step | Decision it gates |
|------------|------|-------------------|
| `checkForUpdates` | Check 4 | Check for newer Muggle version |

## Checks

1. **Electron app** — read `~/.muggle-ai/electron-app/` to find the installed version directory. Read `.install-metadata.json` to get version and checksum. Verify the binary exists at the expected path. On macOS, check code signing with `spctl --assess --verbose`.

2. **MCP server** — call `muggle-local-check-status` to verify the server is responsive. Report auth state (authenticated, email, token expiry).

3. **Authentication** — call `muggle-remote-auth-status`. Report whether credentials are valid and when they expire.

4. **CLI version** — gate `checkForUpdates` (per `preference-gates/GATE.md`):
   - Pro-action: run the check below.
   - Skip-action: render the row as `[skip]  check disabled by preference`.

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
