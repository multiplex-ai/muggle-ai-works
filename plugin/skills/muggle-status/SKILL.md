---
name: muggle-status
description: Check health of the Muggle AI installation. Use when user types muggle status, asks for Muggle health, MCP health, or auth validity.
---

# Muggle Status

Run a full health check and report results.

## Preferences

User preferences are available in the session context (injected at session start). Look for the line starting with `Muggle Preferences` — it contains key=value pairs like `autoLogin=ask showElectronBrowser=always ...`.

If no preferences line is present, treat all preferences as `"ask"`.

When you reach a decision gated by a preference:
- **`always`** → proceed without asking the user
- **`never`** → skip without asking the user  
- **`ask`** → ask the user, then offer: "Want me to remember this choice for future sessions?" If yes, call `muggle-local-preferences-set` with the key, their chosen value, and scope `global`.

This skill uses these preferences:

| Preference | Decision it gates |
|------------|------------------|
| `checkForUpdates` | Check for newer Muggle version |

## Checks

1. **Electron app** — read `~/.muggle-ai/electron-app/` to find the installed version directory. Read `.install-metadata.json` to get version and checksum. Verify the binary exists at the expected path. On macOS, check code signing with `spctl --assess --verbose`.

2. **MCP server** — call `muggle-local-check-status` to verify the server is responsive. Report auth state (authenticated, email, token expiry).

3. **Authentication** — call `muggle-remote-auth-status`. Report whether credentials are valid and when they expire.

4. **CLI version** — capture installed (`muggle --version`) and latest (`npm view @muggleai/works version`). Compare with `sort -V`; flag as out-of-date only when latest is strictly greater.

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
