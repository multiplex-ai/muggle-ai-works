---
name: muggle-status
description: Check health of the Muggle AI installation. Use when user types muggle status, asks for Muggle health, MCP health, or auth validity.
---

# Muggle Status

Run a full health check and report results.

## Preferences

This skill uses preference gates to skip / auto-confirm decisions when the user has saved a choice.

**Single source of truth: `plugin/skills/muggle-preferences/preference-gates.md`.** Read that doc for: how a gate fires, the silent-mode footer, the shared Picker 2 template, the saved-value invariant, and per-key Picker 1 specs.

This skill must NOT redefine prompts inline — it only names which gate fires at which step, plus any step-specific side effects.

| Preference | Step | Decision it gates |
|------------|------|-------------------|
| `checkForUpdates` | Check 4 | Check for newer Muggle version |

## Checks

1. **Electron app** — read `~/.muggle-ai/electron-app/` to find the installed version directory. Read `.install-metadata.json` to get version and checksum. Verify the binary exists at the expected path. On macOS, check code signing with `spctl --assess --verbose`.

2. **MCP server** — call `muggle-local-check-status` to verify the server is responsive. Report auth state (authenticated, email, token expiry).

3. **Authentication** — call `muggle-remote-auth-status`. Report whether credentials are valid and when they expire.

4. **CLI version** (gated by `checkForUpdates`) — apply the `checkForUpdates` gate (see `preference-gates.md`).
   - On `always` (or Picker 1 → "Yes, check"): run the check.
   - On `never` (or Picker 1 → "No, skip"): render the row as `[skip]  check disabled by preference`.

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
