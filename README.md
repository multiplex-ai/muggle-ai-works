# @muggleai/works

Unified MCP server for Muggle AI - combines Cloud QA and Local Testing tools into a single package.

## Installation

```bash
npm install -g @muggleai/works
```

This is the canonical one-liner install path.

It automatically:
1. Installs the package
2. Downloads the Electron app binary (via postinstall)
3. Registers/updates `~/.cursor/mcp.json` with a `muggle` server entry
4. Sets up CLI commands

## Quick Start

### 1. Validate your install

```bash
muggle --version
muggle doctor
```

### 2. Add to your MCP client (if needed)

**Cursor (`~/.cursor/mcp.json`):**

```json
{
  "mcpServers": {
    "muggle": {
      "command": "muggle",
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
muggle serve              # Start server with all tools (default)
muggle serve --qa         # Cloud QA tools only
muggle serve --local      # Local testing tools only

# Setup & Diagnostics
muggle setup              # Download/update Electron app
muggle setup --force      # Force re-download
muggle doctor             # Diagnose installation issues

# Authentication (optional - auth happens automatically)
muggle login              # Manually trigger login
muggle logout             # Clear credentials
muggle status             # Show auth status

# Info
muggle --version          # Show version
muggle --help             # Show help
```

## Authentication

Authentication happens automatically when you first use a tool that requires it:

1. A browser window opens with a verification code
2. You log in with your Muggle AI account
3. The tool call continues with your credentials

Your credentials are stored in `~/.muggle-ai/credentials.json` and persist across sessions.

### Handling Expired Tokens

Tokens expire after a period of time. When this happens:

1. **Check status**: Run `muggle status` or call `muggle-remote-auth-status` to see expiration
2. **Re-authenticate**: Run `muggle login` or call `muggle-remote-auth-login` to get fresh tokens
3. **If login fails with "unauthorized_client"**: Check your runtime target configuration (see Troubleshooting)

The MCP server will attempt to auto-refresh tokens when possible, but manual re-authentication may be required if the refresh token has also expired.

## Muggle Do (`/muggle-do`)

An autonomous development pipeline that takes your code changes through requirements analysis, testing, QA, and PR creation — all inside Claude Code.

### How it works

```
You write code on a feature branch
         |
         v
/muggle-do "what I built"
         |
    Stage 1: Requirements    → extracts goal + acceptance criteria
    Stage 2: Impact Analysis → detects which repos have git changes
    Stage 3: Validate        → checks feature branch, commits exist
    Stage 4: Unit Tests      → runs test commands, fails fast
    Stage 5: QA              → runs Muggle AI test cases
    Stage 6: Open PRs        → pushes branch, creates PR with QA results
         |
         v
    PR ready for review
```

### Step by step

**1. Make your changes on a feature branch:**

```bash
cd /path/to/your/repo
git checkout -b feat/add-login
# ... write your code ...
git add -A && git commit -m "feat: add login page"
```

**2. Configure your repos** — create `muggle-repos.json` in the muggle-ai-works root:

```json
[
  { "name": "frontend", "path": "/absolute/path/to/frontend", "testCommand": "pnpm test" }
]
```

**3. Open Claude Code and run the dev cycle:**

```
/muggle-do "Add a login page with email/password authentication"
```

Claude will detect your changes, run tests, trigger QA, and open a PR.

### What if something fails?

| Failure | What happens |
|---|---|
| No changes detected | Stops — make changes first, re-run |
| On main/master | Stops — create a feature branch first |
| Unit tests fail | Shows output, stops — fix and re-run |
| QA fails | Shows failing tests — fix and re-run |

### Repo config

| Field | Required | Default | Description |
|---|---|---|---|
| `name` | yes | — | Short identifier for the repo |
| `path` | yes | — | Absolute path on your machine |
| `testCommand` | no | `pnpm test` | Command to run unit tests |

---

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
| `ci.yml` | Push/PR to `master` | Lint, test, build on multiple platforms/versions |
| `publish-works.yml` | Tag `v*` or manual dispatch | Verify, package-audit, smoke-install, publish to npm |

### Publishing a new version

1. Update version in `package.json`
2. Commit and push
3. Create a git tag: `git tag v1.0.1 && git push --tags`
4. The `publish-works.yml` workflow publishes to npm automatically

## Troubleshooting

### Expired Token Errors

If you see authentication errors like "Not authenticated" or token expiration messages:

1. **Check auth status**:
   ```bash
   muggle status
   ```

2. **Re-authenticate**:
   ```bash
   muggle login
   ```

3. **Clear and retry** (if login keeps failing):
   ```bash
   muggle logout
   muggle login
   ```

### "unauthorized_client" Error During Login

This error indicates a mismatch between your Auth0 client configuration and the target environment.

**Cause**: The MCP is configured for one environment (dev/production) but trying to authenticate against another.

**Fix**: Ensure your MCP configuration matches your intended environment by setting the `MUGGLE_MCP_PROMPT_SERVICE_TARGET` environment variable in your MCP config:

**For Production** (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "muggle": {
      "command": "muggle",
      "args": ["serve"],
      "env": {
        "MUGGLE_MCP_PROMPT_SERVICE_TARGET": "production"
      }
    }
  }
}
```

**For Development** (local services):
```json
{
  "mcpServers": {
    "muggle": {
      "command": "muggle",
      "args": ["serve"],
      "env": {
        "MUGGLE_MCP_PROMPT_SERVICE_TARGET": "dev"
      }
    }
  }
}
```

After changing the configuration, restart your MCP client (e.g., restart Cursor).

### Credential Files

Credentials are stored in `~/.muggle-ai/`:

| File | Purpose |
| :--- | :------ |
| `auth.json` | OAuth tokens (access token, refresh token, expiry) |
| `credentials.json` | API key for service calls |

If you need to reset authentication completely:
```bash
rm ~/.muggle-ai/auth.json
rm ~/.muggle-ai/credentials.json
muggle login
```

## License

MIT
