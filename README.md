# muggle-ai-works

**Ship quality products, not just code.** AI-powered QA that validates your app's user experience — from Claude Code and Cursor to PR.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@muggleai/works)]()
[![MCP Tools](https://img.shields.io/badge/MCP_tools-70+-green)]()
[![Node](https://img.shields.io/badge/node-22+-orange)]()

One install gives your AI coding assistant the ability to QA your app like a real user would — clicking through flows, catching broken experiences, and opening PRs with results.

Part of the **Muggle AI** open-source ecosystem:

| Package | Purpose | Install |
|---------|---------|---------|
| **muggle-ai-works** (this repo) | QA testing MCP server + autonomous dev pipeline | `npm install @muggleai/works` |
| **[muggle-ai-teams](https://github.com/multiplex-ai/muggle-ai-teams)** | Agent orchestration, workflow, skills, rules | `npm install @muggleai/teams` |

muggle-ai-works handles *QA verification* (test generation, browser replay, cloud results). muggle-ai-teams handles *how work gets done* (design → implement → review → deliver). Together, they form a complete AI-assisted development workflow with built-in quality assurance.

---

## How Is This Different?

Most AI coding tools help you *write* code. muggle-ai-works helps you *test* it — automatically, using AI-driven browser automation.

| | **muggle-ai-works** | **Playwright MCP** | **Manual QA** |
|---|---|---|---|
| **Test creation** | Natural language → test cases | Write code manually | Write test plans manually |
| **Test execution** | AI-driven browser (Electron app) | Scripted browser automation | Human clicks through flows |
| **Localhost testing** | Built-in URL rewriting | Manual config | Manual |
| **Cloud sync** | Automatic (projects, cases, scripts, results) | None | Spreadsheets |
| **Integration** | MCP tools for any AI assistant | Playwright API | None |
| **Learning curve** | Describe what to test in English | Learn Playwright API | Train QA team |

---

## Quick Start

### 1. Install

```bash
npm install @muggleai/works
```

This automatically:
1. Downloads the QA engine (Electron app) for browser automation
2. Registers the MCP server in `~/.cursor/mcp.json`
3. Installs skills (`/muggle-do`, `/test-feature-local`) to `~/.claude/`

### 2. Verify

```bash
muggle --version
muggle doctor
```

### 3. Start testing

In Claude Code or Cursor, just ask:

> "Test my login flow on localhost:3000"

Your AI assistant will authenticate, find or create test cases, launch the browser, record/replay tests, and show you results with screenshots.

---

## How It Works

### Design principle: "Create remotely, execute locally"

All entity management (projects, use cases, test cases) lives in the **cloud** via `muggle-remote-*` tools. Local execution (`muggle-local-*`) is stateless — it receives everything it needs as input and just runs tests.

### Entity model

```
Project (e.g., "My App")
  └── Use Case (e.g., "User Login Flow")
       └── Test Case (e.g., "Login with valid credentials")
            └── Test Script (recorded browser automation steps)
                 └── Run Result (pass/fail + screenshots)
```

### Test execution flow

```
Your AI assistant describes what to test
         │
         v
muggle-remote-* tools create test cases in cloud
         │
         v
muggle-local-execute-test-generation launches the QA engine
         │
         v
AI agent drives the browser step-by-step (click, type, navigate, assert)
         │
         v
Screenshots captured per step → action-script.json recorded
         │
         v
Results: pass/fail with evidence at ~/.muggle-ai/sessions/{runId}/
         │
         v
muggle-local-publish-test-script uploads to cloud
```

---

## Three Ways to Use It

### 1. `/test-feature-local` — Test a feature on localhost

Interactive workflow: pick a project → pick a use case → pick a test case → run against localhost.

```
> /test-feature-local

"Test my login changes on localhost:3999"

1. Auth check ✓
2. Found project: "My App"
3. Found use case: "User Login"
4. Found 2 test cases — recommend replay (minor changes detected)
5. Launching QA engine... (approve? y)
6. Results: 2/2 PASS
   Screenshots: ~/.muggle-ai/sessions/abc123/screenshots/
7. Publish to cloud? (y)
```

### 2. `/muggle-do` — Autonomous dev pipeline

Full development cycle: requirements → code → unit tests → QA → PR creation.

```
> /muggle-do "Add a logout button to the header"

REQUIREMENTS  → Goal: Add logout button. Criteria: visible, functional, redirects.
IMPACT        → frontend repo, src/components/Header.tsx
VALIDATE      → Branch: feat/add-logout, 1 commit
CODING        → (writes/fixes code)
UNIT_TESTS    → 12/12 pass
QA            → 3/3 test cases pass
OPEN_PRS      → PR #42 opened
DONE          → 1 iteration, all green
```

Features:
- Session-based with crash recovery (`.muggle-do/sessions/`)
- Auto-triage: analyzes failures, jumps back to fix (max 3 iterations)
- Multi-repo support via `muggle-repos.json`
- Creates PRs with QA results in description

### 3. Direct MCP tool calls — Build your own workflow

Use any of the 70+ MCP tools directly from your AI assistant:

```
"Create a project called My App with URL https://myapp.com"
"Generate test cases for the checkout flow"
"Replay all test scripts against localhost:3000"
"Show me the latest QA results"
```

---

## Integration with muggle-ai-teams

When both packages are installed, muggle-ai-teams automatically integrates QA into its workflow:

| Workflow Step | What Happens |
|--------------|-------------|
| **Step 1F** (Plan) | QA test instructions written per implementation slice |
| **Step 2** (Execute) | Per-slice QA via muggle-ai-works before each commit |
| **Step 3** (Verify) | Full regression sweep replaying all project scripts |
| **Step 5** (Push) | QA results published to cloud, linked in PR description |

Frontend slices get browser QA. Backend-only slices are verified by unit tests (browser QA skipped with documented reasoning).

Install both: `npm install @muggleai/works @muggleai/teams`

---

## Available MCP Tools (70+)

### Authentication (`muggle-remote-auth-*`)

| Tool | Purpose |
|------|---------|
| `muggle-remote-auth-status` | Check authentication status |
| `muggle-remote-auth-login` | Start device-code login flow |
| `muggle-remote-auth-poll` | Poll for login completion |
| `muggle-remote-auth-logout` | Clear credentials |

### Project Management (`muggle-remote-project-*`)

| Tool | Purpose |
|------|---------|
| `muggle-remote-project-create` | Create QA project |
| `muggle-remote-project-list` | List all projects |
| `muggle-remote-project-get` | Get project details |
| `muggle-remote-project-update` | Update project |
| `muggle-remote-project-delete` | Delete project |

### Use Cases (`muggle-remote-use-case-*`)

| Tool | Purpose |
|------|---------|
| `muggle-remote-use-case-list` | List use cases |
| `muggle-remote-use-case-create-from-prompts` | Create from natural language |
| `muggle-remote-use-case-prompt-preview` | Preview before creating |
| `muggle-remote-use-case-update-from-prompt` | Regenerate from new prompt |

### Test Cases (`muggle-remote-test-case-*`)

| Tool | Purpose |
|------|---------|
| `muggle-remote-test-case-list` | List all test cases |
| `muggle-remote-test-case-list-by-use-case` | List by use case |
| `muggle-remote-test-case-get` | Get test case details |
| `muggle-remote-test-case-create` | Create test case |
| `muggle-remote-test-case-generate-from-prompt` | Generate from prompt |

### Test Scripts & Workflows (`muggle-remote-workflow-*`)

| Tool | Purpose |
|------|---------|
| `muggle-remote-test-script-list` | List test scripts |
| `muggle-remote-test-script-get` | Get script details |
| `muggle-remote-workflow-start-website-scan` | Scan site for use cases |
| `muggle-remote-workflow-start-test-case-detection` | Generate test cases |
| `muggle-remote-workflow-start-test-script-generation` | Generate scripts |
| `muggle-remote-workflow-start-test-script-replay` | Replay single script |
| `muggle-remote-workflow-start-test-script-replay-bulk` | Batch replay |

### Local Execution (`muggle-local-*`)

| Tool | Purpose |
|------|---------|
| `muggle-local-check-status` | Check local QA engine status |
| `muggle-local-execute-test-generation` | Generate test script locally |
| `muggle-local-execute-replay` | Replay existing script locally |
| `muggle-local-cancel-execution` | Cancel active execution |
| `muggle-local-run-result-list` | List run results |
| `muggle-local-run-result-get` | Get detailed results + screenshots |
| `muggle-local-publish-test-script` | Publish script to cloud |

### Reports & Analytics (`muggle-remote-report-*`)

| Tool | Purpose |
|------|---------|
| `muggle-remote-report-stats-summary-get` | Report statistics |
| `muggle-remote-report-cost-query` | Query cost/usage |
| `muggle-remote-report-final-generate` | Generate final report (PDF/HTML/Markdown) |
| `muggle-remote-project-test-results-summary-get` | Test results summary |

Also available: PRD processing (`muggle-remote-prd-*`), secrets management (`muggle-remote-secret-*`), wallet/billing (`muggle-remote-wallet-*`), and scheduling recommendations (`muggle-remote-recommend-*`).

---

## CLI Commands

```bash
# Server (main command — starts MCP server for AI clients)
muggle serve              # Start with all tools (default)
muggle serve --qa         # Cloud QA tools only
muggle serve --local      # Local QA tools only

# Setup & Diagnostics
muggle setup              # Download/update QA engine
muggle setup --force      # Force re-download
muggle doctor             # Diagnose installation issues

# Authentication
muggle login              # Manually trigger login
muggle logout             # Clear credentials
muggle status             # Show auth status

# Info
muggle --version          # Show version
muggle --help             # Show help
```

---

## Authentication

Authentication happens automatically when you first use a tool that requires it:

1. A browser window opens with a verification code
2. You log in with your Muggle AI account
3. The tool call continues with your credentials

Credentials are stored in `~/.muggle-ai/` and persist across sessions.

### Handling expired tokens

1. **Check status**: `muggle status` or `muggle-remote-auth-status`
2. **Re-authenticate**: `muggle login` or `muggle-remote-auth-login`
3. **If "unauthorized_client"**: Check `MUGGLE_MCP_PROMPT_SERVICE_TARGET` environment variable (see Troubleshooting)

---

## Data Directory

```
~/.muggle-ai/
├── auth.json             # OAuth tokens
├── credentials.json      # API key for service calls
├── projects/             # Local project cache
├── sessions/             # QA sessions
│   └── {runId}/
│       ├── action-script.json    # Recorded browser steps
│       ├── results.md            # Step-by-step report
│       └── screenshots/          # Per-step images
└── electron-app/         # Downloaded QA engine
    └── {version}/
```

---

## Platform Compatibility

| Platform | MCP Tools | /muggle-do | /test-feature-local |
|----------|-----------|-----------|-------------------|
| **Claude Code** | Yes | Yes | Yes |
| **Cursor** | Yes (via MCP) | No (needs Agent tool) | No (needs Skill tool) |
| **Others** | Via MCP if supported | No | No |

The MCP server (`muggle serve`) works with any MCP-compatible client. The distributed skills (`/muggle-do`, `/test-feature-local`) require Claude Code's Agent and Skill tools.

---

## Configuration

### MCP client config

**Cursor** (`~/.cursor/mcp.json`) — auto-configured on install:

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

### Environment targeting

Set `MUGGLE_MCP_PROMPT_SERVICE_TARGET` to switch between production and dev:

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

### Multi-repo config for /muggle-do

Create `muggle-repos.json` in your working directory:

```json
[
  { "name": "frontend", "path": "/absolute/path/to/frontend", "testCommand": "pnpm test" },
  { "name": "backend", "path": "/absolute/path/to/backend", "testCommand": "pnpm test" }
]
```

---

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm run build

# Dev mode (watch)
pnpm run dev

# Test
pnpm test
pnpm run test:watch

# Lint
pnpm run lint          # Auto-fix
pnpm run lint:check    # Check only

# Typecheck
pnpm run typecheck
```

### CI/CD

| Workflow | Trigger | Description |
|----------|---------|-------------|
| `ci.yml` | Push/PR to `master` | Lint, test, build on multiple platforms |
| `publish-works.yml` | Tag `v*` or manual | Verify, audit, smoke-install, publish to npm |

### Publishing

```bash
# Update version in package.json
git tag v2.0.1 && git push --tags
# publish-works.yml handles the rest
```

---

## Troubleshooting

### "unauthorized_client" during login

**Cause**: MCP configured for one environment but authenticating against another.

**Fix**: Set the correct `MUGGLE_MCP_PROMPT_SERVICE_TARGET` in your MCP config and restart your client.

### QA engine not found

```bash
muggle setup --force    # Re-download
muggle doctor           # Diagnose
```

### Authentication keeps expiring

```bash
muggle logout           # Clear all credentials
rm ~/.muggle-ai/auth.json ~/.muggle-ai/credentials.json
muggle login            # Fresh login
```

---

## About

Built by the team behind **[MuggleTest](https://www.muggletest.com)** — an AI-powered QA testing platform that makes software testing accessible to everyone, no coding required.

**Muggle AI open-source ecosystem:**
- **[muggle-ai-works](https://github.com/multiplex-ai/muggle-ai-works)** — QA testing MCP server + autonomous dev pipeline (this repo)
- **[muggle-ai-teams](https://github.com/multiplex-ai/muggle-ai-teams)** — Agent orchestration, workflow, skills, and rules

---

## License

[MIT](LICENSE) — Use it, fork it, make it yours.

---

If this helps your development workflow, consider giving it a star. It helps others find it.
