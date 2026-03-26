# Migrating to Plugin-First Install

Starting with v3, Muggle AI distributes skills, MCP configuration, and hooks as a **Claude Code plugin** installed from a marketplace. The previous `npm install` approach that copied files to `~/.claude/` and `~/.cursor/` is deprecated.

## What changed

| Before (v2) | After (v3+) |
|:---|:---|
| `npm install @muggleai/works` copies skills to `~/.claude/` | Skills are bundled inside the plugin |
| Postinstall writes MCP config to `~/.cursor/mcp.json` | MCP config is managed by the plugin |
| Skills invoked as `/muggle-do`, `/test-feature-local` | Skills invoked as `/muggle:muggle-do`, `/muggle:test-feature-local` |
| Updates require `npm install` again | Updates via `/plugin update muggle@<marketplace>` |

## How to install (new path)

```bash
# In Claude Code:
/plugin marketplace add <marketplace-url>
/plugin install muggle@<marketplace-name>
```

This gives you:

- `/muggle:muggle-do` -- autonomous dev pipeline
- `/muggle:test-feature-local` -- local QA testing
- `/muggle:publish-test-to-cloud` -- publish local runs to cloud
- MCP server auto-started by the plugin
- Electron app provisioned on session start via plugin hooks

## Cleanup (remove legacy artifacts)

After installing via the plugin, remove leftover files from the old approach:

```bash
# Remove old skill files
rm -rf ~/.claude/skills/muggle/
rm -f ~/.claude/commands/muggle-do.md

# Remove old MCP registration (if you only use Claude Code, not Cursor)
# Edit ~/.cursor/mcp.json and remove the "muggle" entry under mcpServers
```

## If you still use Cursor

Cursor does not support Claude Code plugins. If you use Cursor alongside Claude Code:

- Continue using `npm install @muggleai/works` for the MCP server binary
- Manually configure `~/.cursor/mcp.json` with `"command": "muggle", "args": ["serve"]`
- Skills (`/muggle-do`, etc.) are not available in Cursor -- use MCP tools directly

## Upgrade and uninstall

```bash
# Upgrade to latest plugin version
/plugin update muggle@<marketplace-name>

# Uninstall
/plugin uninstall muggle@<marketplace-name>
```

## Questions

If you run into issues, run `muggle doctor` to check your installation health, or file an issue at [github.com/multiplex-ai/muggle-ai-works](https://github.com/multiplex-ai/muggle-ai-works/issues).
