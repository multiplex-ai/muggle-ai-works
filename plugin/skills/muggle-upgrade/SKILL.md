---
name: muggle-upgrade
description: Update Muggle AI to latest version. Use when user types muggle upgrade or asks to update Muggle tools.
---

# Muggle Upgrade

Update all Muggle AI components to the latest published version.

## Steps

1. Run `/muggle:muggle-status` checks to capture current versions.
2. Run `muggle setup --force` to download the latest Electron QA engine.
3. Report the upgrade results:
   - Previous version vs new version for each component.
   - Whether the upgrade succeeded or failed.
4. Run `/muggle:muggle-status` again to confirm everything is healthy after upgrade.

## Output

Show a before/after version comparison. If the upgrade fails at any step, report the error and suggest running `/muggle:muggle-repair`.
