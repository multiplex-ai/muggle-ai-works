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

This updates the CLI, configures Cursor MCP (`~/.cursor/mcp.json`), and syncs `muggle-*` skills (plus their short `m*` aliases) into `~/.cursor/skills/`. Claude slash commands remain plugin-managed, so use `/plugin update muggleai@muggle-works` to refresh them.

## Skills

Type `muggle` to discover the full command family.

| Skill | Shorthand | What it does |
|:---|:---|:---|
| `/muggle:muggle` | `/m` | Router and menu for all Muggle Test commands. |
| `/muggle:muggle-do` | `/mdo` | Autonomous dev pipeline: requirements, code, unit tests, E2E acceptance tests, PR. |
| `/muggle:muggle-test` | `/mtest` | Change-driven E2E acceptance router: detects code changes, maps to use cases, runs test generation locally or remotely, publishes to dashboard, opens in browser, posts E2E acceptance results to PR. |
| `/muggle:muggle-test-feature-local` | `/mtestlocal` | Test a feature on localhost with AI-driven browser automation. Offers publish to cloud after each run. |
| `/muggle:muggle-test-prepare` | `/mtestprep` | Verify the dev servers and sibling services a test run needs, and start whatever is missing. |
| `/muggle:muggle-test-import` | `/mimport` | Import existing tests into Muggle Test — from Playwright/Cypress specs, PRDs, Gherkin feature files, test plan docs, or any test artifact. |
| `/muggle:muggle-test-regenerate-missing` | `/mregen` | Bulk-regenerate test scripts for every test case in a project that doesn't currently have an active script. Scans DRAFT + GENERATION_PENDING, confirms the list with the user, and dispatches remote generation workflows for each. |
| `/muggle:muggle-browser-task` | `/mbt` | Perform a real action on a website from plain English — log in and submit the form, create the ticket, refund the charge. |
| `/muggle:muggle-pr-visual-walkthrough` | `/mpr` | Post per-test-case dashboard links, step-by-step screenshots, and a pass/fail summary to a PR. |
| `/muggle:muggle-pr-followup` | `/mprfollowup` | Watch one PR's review thread and dispatch the work to address incoming feedback. |
| `/muggle:muggle-feedback` | `/mfeedback` | Flag a generated action script, or one step in it, as wrong so Muggle can analyze and regenerate affected scripts. |
| `/muggle:muggle-preferences` | `/mprefs` | View, set, or reset the preferences that gate Muggle Test behavior. |
| `/muggle:muggle-status` | `/mstatus` | Health check for Electron browser test runner, MCP server, and authentication. |
| `/muggle:muggle-repair` | `/mrepair` | Diagnose and fix broken installation automatically. |
| `/muggle:muggle-upgrade` | `/mupgrade` | Update Electron browser test runner and MCP server to latest version. |

Every skill ships the short alias in the table above. Type `/m` (Claude Code) or `m` (Cursor) to open the menu, or jump straight to one (e.g. `/mtest`). Claude Code namespaces plugin commands, so the aliases resolve as `/muggle:mtest`; mirror them into `~/.claude/commands/` to type `/mtest` bare.

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
