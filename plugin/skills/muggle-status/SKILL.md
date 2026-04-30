---
name: muggle-status
description: Check health of the Muggle AI installation. Use when user types muggle status, asks for Muggle health, MCP health, or auth validity.
---

# Muggle Status

Run a full health check and report results.

## Preferences

User preferences are injected by the SessionStart hook into a `Muggle Preferences` line in session context (key=value pairs). Resolution: defaults → `~/.muggle-ai/preferences.json` (global) → `<repo>/.muggle-ai/preferences.json` (project). Treat absent prefs as `ask`.

**At every preference-gated step below**, apply this rule:

- `always` → perform the auto-action silently. **Skip both pickers.**
- `never` → skip the action silently. **Skip both pickers.**
- `ask` (or absent) → run the **2-picker flow**:
  1. **Picker 1** (`AskQuestion`): the substantive choice for this step. Each option maps to either `always` or `never`.
  2. **Picker 2** (`AskQuestion`): `"Remember this? Next time I'll automatically <action description> without asking. (preference: <key> = <value>)"` with options:
     - "Yes, save it"
     - "No, just for this run"
  3. On **"Yes, save it"** → call `muggle-local-preferences-set` with `key`, the value chosen in Picker 1, `scope: "global"`.

| Preference | Step | Decision it gates |
|------------|------|-------------------|
| `checkForUpdates` | Check 4 | Check for newer Muggle version |

## Checks

1. **Electron app** — read `~/.muggle-ai/electron-app/` to find the installed version directory. Read `.install-metadata.json` to get version and checksum. Verify the binary exists at the expected path. On macOS, check code signing with `spctl --assess --verbose`.

2. **MCP server** — call `muggle-local-check-status` to verify the server is responsive. Report auth state (authenticated, email, token expiry).

3. **Authentication** — call `muggle-remote-auth-status`. Report whether credentials are valid and when they expire.

4. **CLI version** (gated by `checkForUpdates`) — apply the gate (see Preferences for the full 2-picker flow):
   - **`checkForUpdates = always`** → run the version check silently and report. Skip both pickers.
   - **`checkForUpdates = never`** → skip this check entirely; render the row as `[skip]  check disabled by preference`. Skip both pickers.
   - **`checkForUpdates = ask` (or absent)** → run the 2-picker flow:
     - **Picker 1**: `"Check npm for a newer Muggle version? Requires a network call."`
       - "Yes, check" → maps to `checkForUpdates = always`. Run the check.
       - "No, skip" → maps to `checkForUpdates = never`. Render `[skip]`.
     - **Picker 2**: `"Remember this? Next time I'll automatically <check for updates | skip the check> without asking. (preference: checkForUpdates = <always|never>)"`
       - "Yes, save it" → call `muggle-local-preferences-set` with `key: "checkForUpdates"`, `value: "<always|never>"`, `scope: "global"`.
       - "No, just for this run" → continue without saving.

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
