---
name: repair
description: Diagnose and fix a broken Muggle AI installation — re-downloads Electron app and resets credentials if needed.
---

# Muggle AI Repair

Automatically diagnose and fix broken components.

## Steps

1. Run the same checks as `/muggle:status` to identify what is broken.
2. If everything passes, report: "Nothing to repair — installation looks healthy."
3. For each failing component:
   - **Electron app missing or corrupt** — run `muggle setup --force` to re-download.
   - **Authentication expired or invalid** — run `muggle-remote-auth-login` to re-authenticate.
   - **MCP server unresponsive** — report the error and suggest restarting the session.
4. Run status checks again to confirm all components are healthy.
5. Report what was repaired.

## Output

Show before/after status for each repaired component. If repair fails, report the error with enough context for the user to investigate.
