---
name: muggle-upgrade
description: Update Muggle AI to latest version. Use when user types muggle upgrade or asks to update Muggle tools.
---

# Muggle Upgrade

Update all Muggle AI components to the latest published version. This means **both** the `@muggleai/works` CLI on npm **and** the Electron runner the CLI manages.

## Steps

1. Run `/muggle:muggle-status` checks to capture current versions.

2. Capture CLI versions:
   - Installed CLI: `muggle --version`
   - Latest on npm: `npm view @muggleai/works version`
   - Detect install location: `npm ls -g @muggleai/works --depth=0` (falls back to `pnpm ls -g @muggleai/works` if not found)

3. **If installed CLI < latest on npm**, upgrade the CLI itself before touching Electron:
   - npm global install: `npm install -g @muggleai/works@latest`
   - pnpm global install: `pnpm add -g @muggleai/works@latest`
   - If neither is detected, report the situation and ask the user how the CLI was installed before proceeding.

4. Run `muggle upgrade` to pull the Electron runner version that the (now-latest) CLI expects.
   - Note: `muggle upgrade` only manages the Electron runner — it does NOT upgrade the CLI npm package. That is why step 3 must run first.

5. **Reload plugins** — the npm install (step 3) triggers a postinstall script that updates the plugin cache at `~/.claude/plugins/cache/`, but Claude Code only picks up new skills/agents/hooks after a reload. Tell the user:

   > Run **`/reload-plugins`** to load the updated skills, agents, and hooks.

   Wait for the user to confirm they've reloaded before proceeding.

6. Run `/muggle:muggle-status` again to confirm everything is healthy after upgrade.

## Output

Show a before/after table for **CLI**, **Electron runner**, **MCP server**, and **Auth**. Call out any version that did not change so the user understands what shipped vs what was already current.

If any component upgraded, always end with the `/reload-plugins` reminder — even if the user doesn't need new features right away, stale cached skills can cause confusing behavior.

If the upgrade fails at any step, report the error and suggest running `/muggle:muggle-repair`.
