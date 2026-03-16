# @muggleai/mcp

Unified MCP server for Muggle AI - combines Cloud QA and Local Testing tools into a single package.

## Installation

```bash
npm install -g @muggleai/mcp
```

This automatically:
1. Installs the package
2. Downloads the Electron app binary (via postinstall)
3. Sets up CLI commands

## Quick Start

### 1. Add to your MCP client

**Cursor (`~/.cursor/mcp.json`):**

```json
{
  "mcpServers": {
    "muggle": {
      "command": "muggle-mcp",
      "args": ["serve"]
    }
  }
}
```

### 2. Start using MCP tools

Ask your AI assistant to test your application! Authentication happens automatically when needed.

## CLI Commands

```bash
# Server (main command - starts MCP server for AI clients)
muggle-mcp serve              # Start server with all tools (default)
muggle-mcp serve --qa         # Cloud QA tools only
muggle-mcp serve --local      # Local testing tools only

# Setup & Diagnostics
muggle-mcp setup              # Download/update Electron app
muggle-mcp setup --force      # Force re-download
muggle-mcp doctor             # Diagnose installation issues

# Authentication (optional - auth happens automatically)
muggle-mcp login              # Manually trigger login
muggle-mcp logout             # Clear credentials
muggle-mcp status             # Show auth status

# Info
muggle-mcp --version          # Show version
muggle-mcp --help             # Show help
```

## Authentication

Authentication happens automatically when you first use a tool that requires it:

1. A browser window opens with a verification code
2. You log in with your Muggle AI account
3. The tool call continues with your credentials

Your credentials are stored in `~/.muggle-ai/credentials.json` and persist across sessions.

## Available Tools

### Cloud QA Tools (muggle-remote-*)

Tools that work with the Muggle AI cloud backend:

- `muggle-remote-project-create` - Create QA project
- `muggle-remote-project-list` - List projects
- `muggle-remote-use-case-create-from-prompts` - Create use cases
- `muggle-remote-test-case-generate-from-prompt` - Generate test cases
- `muggle-remote-workflow-start-*` - Start various workflows
- And more...

### Local QA Tools (muggle-local-*)

Tools that work with local testing:

- `muggle-local-check-status` - Check local status
- `muggle-local-list-sessions` - List sessions
- `muggle-local-execute-test-generation` - Generate test script
- `muggle-local-execute-replay` - Replay test script
- `muggle-local-run-result-list` - List run results
- `muggle-local-publish-test-script` - Publish to cloud
- And more...

## Data Directory

All Muggle AI data is stored in `~/.muggle-ai/`:

```
~/.muggle-ai/
├── credentials.json      # Auth credentials (auto-generated)
├── projects/             # Local test projects
├── sessions/             # Test execution sessions
└── electron-app/         # Downloaded Electron app
    └── 1.0.0/
        └── MuggleAI.exe
```

## Requirements

- Node.js 22 or higher
- For local testing: Electron app (downloaded automatically)

## Development

### Building

```bash
npm install
npm run build
```

### Testing

```bash
npm test              # Run tests once
npm run test:watch    # Watch mode
```

### Linting

```bash
npm run lint          # Auto-fix issues
npm run lint:check    # Check only
```

## CI/CD Workflows

| Workflow | Trigger | Description |
| :------- | :------ | :---------- |
| `ci.yml` | Push/PR to main | Lint, test, build on multiple platforms/versions |
| `publish-mcp.yml` | Tag `v*` | Publish package to npm |
| `release-electron-app.yml` | Tag `electron-app@*` | Build and release Electron binaries |

### Publishing a new version

1. Update version in `package.json`
2. Commit and push
3. Create a git tag: `git tag v1.0.1 && git push --tags`
4. The `publish-mcp.yml` workflow publishes to npm automatically

### Releasing Electron app

1. Update `muggleConfig.electronAppVersion` in `package.json`
2. Run the `release-electron-app.yml` workflow manually
3. Or create a tag: `git tag electron-app@1.0.1 && git push --tags`

## License

MIT
