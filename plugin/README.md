# Muggle AI Plugin for Claude Code

Ship quality products with AI-powered end-to-end (E2E) acceptance testing that validates your web app like a real user — from Claude Code and Cursor to PR.

## Install

```
/plugin marketplace add https://github.com/multiplex-ai/muggle-ai-works
/plugin install muggleai@muggle-works
```

For npm installs:

```bash
npm install -g @muggleai/works
```

This updates the CLI and syncs `muggle-*` skills into `~/.cursor/skills/` for Cursor. Claude slash commands remain plugin-managed, so use `/plugin update muggleai@muggle-works` to refresh them.

## Skills

Type `muggle` to discover the full command family.

| Skill | What it does |
|:---|:---|
| `/muggle:muggle` | Router and menu for all Muggle commands. |
| `/muggle:muggle-do` | Autonomous dev pipeline: requirements, code, unit tests, E2E acceptance tests, PR. |
| `/muggle:muggle-test` | Change-driven E2E acceptance router: detects code changes, maps to use cases, runs test generation locally or remotely, publishes to dashboard, opens in browser, posts E2E acceptance results to PR. |
| `/muggle:muggle-test-feature-local` | Test a feature on localhost with AI-driven browser automation. Offers publish to cloud after each run. |
| `/muggle:muggle-test-import` | Import existing tests into Muggle Test — from Playwright/Cypress specs, PRDs, Gherkin feature files, test plan docs, or any test artifact. |
| `/muggle:muggle-test-regenerate-missing` | Bulk-regenerate test scripts for every test case in a project that doesn't currently have an active script. Scans DRAFT + GENERATION_PENDING, confirms the list with the user, and dispatches remote generation workflows for each. |
| `/muggle:muggle-status` | Health check for Electron browser test runner, MCP server, and authentication. |
| `/muggle:muggle-repair` | Diagnose and fix broken installation automatically. |
| `/muggle:muggle-upgrade` | Update Electron browser test runner and MCP server to latest version. |

## MCP Tools

The plugin ships an MCP server with 70+ tools for project management, test case generation, browser automation, and reporting. The server starts automatically when the plugin is enabled.

## Hooks

A `SessionStart` hook ensures the Electron browser test runner is downloaded and up to date.

## Requirements

- Claude Code 1.0.33 or later
- Node.js 22+

## Upgrade

```
/plugin update muggleai@muggle-works
```

## Uninstall

```
/plugin uninstall muggleai@muggle-works
```

## Links

- [MuggleTest](https://www.muggletest.com)
- [GitHub](https://github.com/multiplex-ai/muggle-ai-works)
## License

MIT
