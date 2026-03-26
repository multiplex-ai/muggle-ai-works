# Muggle AI Plugin for Claude Code

AI-powered QA testing and autonomous dev pipeline for Claude Code. Test your web app with a real browser, generate test cases from plain English, and run a full code-to-PR cycle.

## Install

```
/plugin marketplace add https://github.com/multiplex-ai/muggle-ai-works
/plugin install muggle@muggle-plugins
```

## Skills

| Skill | What it does |
|:---|:---|
| `/muggle:muggle-do` | Autonomous dev pipeline: requirements, code, unit tests, QA, PR |
| `/muggle:test-feature-local` | Test a feature on localhost with AI-driven browser automation |
| `/muggle:publish-test-to-cloud` | Publish local test runs to Muggle AI cloud |

## MCP Tools

The plugin ships an MCP server with 70+ tools for project management, test case generation, browser automation, and reporting. The server starts automatically when the plugin is enabled.

## Hooks

A `SessionStart` hook ensures the Electron QA engine is downloaded and up to date.

## Requirements

- Claude Code 1.0.33 or later
- Node.js 22+

## Upgrade

```
/plugin update muggle@muggle-plugins
```

## Uninstall

```
/plugin uninstall muggle@muggle-plugins
```

## Links

- [MuggleTest](https://www.muggletest.com)
- [GitHub](https://github.com/multiplex-ai/muggle-ai-works)
- [Migration guide](https://github.com/multiplex-ai/muggle-ai-works/blob/master/MIGRATION.md)

## License

MIT
