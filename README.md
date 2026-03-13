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

### Cloud QA Tools

Tools that work with the Muggle AI cloud backend:

- `qa_project_create` - Create QA project
- `qa_project_list` - List projects
- `qa_use_case_create_from_prompts` - Create use cases
- `qa_test_case_generate_from_prompt` - Generate test cases
- `qa_workflow_start_*` - Start various workflows
- And more...

### Local QA Tools

Tools that work with local testing:

- `muggle_project_create` - Create local project
- `muggle_test_case_save` - Save test case locally
- `muggle_execute_test_generation` - Generate test script
- `muggle_execute_replay` - Replay test script
- `muggle_cloud_pull_project` - Pull from cloud
- `muggle_publish_project` - Publish to cloud
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

## License

MIT
