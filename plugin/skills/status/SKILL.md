---
name: status
description: Check health of the Muggle AI installation — Electron QA engine, MCP server, and authentication.
---

# Muggle AI Status

Run a full health check and report results.

## Checks

1. **Electron app** — read `~/.muggle-ai/electron-app/` to find the installed version directory. Read `.install-metadata.json` to get version and checksum. Verify the binary exists at the expected path. On macOS, check code signing with `spctl --assess --verbose`.

2. **MCP server** — call `muggle-local-check-status` to verify the server is responsive. Report auth state (authenticated, email, token expiry).

3. **Authentication** — call `muggle-remote-auth-status`. Report whether credentials are valid and when they expire.

## Output

```
Muggle AI — Status

Electron app   [pass/fail]  version, binary status
MCP server     [pass/fail]  responsive, auth state
Authentication [pass/fail]  user, expiry

[All systems operational / Issues found — run /muggle:repair to fix.]
```

Use pass/fail indicators for each check. If any check fails, tell the user to run `/muggle:repair`.
