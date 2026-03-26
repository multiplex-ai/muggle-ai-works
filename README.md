# muggle-ai-works

**Test your web app with AI — no test code required.**

One install gives your AI coding assistant the power to QA your app like a real user would: clicking through flows, catching broken experiences, and reporting results with screenshots and evidence.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@muggleai/works)]()
[![MCP Tools](https://img.shields.io/badge/MCP_tools-70+-green)]()
[![Node](https://img.shields.io/badge/node-22+-orange)]()

Powered by [MuggleTest](https://www.muggletest.com) — the [AI-powered QA testing platform](https://www.muggletest.com).

---

## What do you get?

muggle-ai-works gives your AI coding assistant three things it doesn't have out of the box: the ability to test your app in a real browser, a fully autonomous dev pipeline from requirements to PR, and 70+ MCP tools for building custom QA workflows.

- **Test features on localhost** — describe what to test in plain English; the AI drives a real browser, clicks through your flows, and reports results with screenshots. No test code to write, no Playwright setup.
- **Autonomous dev pipeline** — run `/muggle:muggle-do` with a requirement in English; the AI codes the feature, writes unit tests, runs QA against your app, and opens a PR — all in one command.
- **70+ MCP tools** — build custom QA workflows using tools for project management, use case discovery, test case generation, browser automation, and reporting. Works with Claude Code, Cursor, and any MCP-compatible client.

---

## Quick Start

### 1. Install

```bash
/plugin marketplace add <marketplace-url-or-path>
/plugin install muggle@<marketplace-name>
```

<details>
<summary>What gets configured automatically</summary>

1. Namespaced skills (`/muggle:muggle-do`, `/muggle:test-feature-local`, `/muggle:publish-test-to-cloud`)
2. Plugin-managed MCP server configuration
3. Plugin hooks for Electron QA engine provisioning

</details>

### 2. Verify

```bash
muggle --version
muggle doctor
```

### 3. Start testing

In Claude Code or Cursor, describe what to test:

> "Test my login flow on localhost:3000"

Your AI assistant authenticates, finds or creates test cases, launches the browser, records and replays tests, and shows results with screenshots.

---

## How does it work?

muggle-ai-works separates test management from test execution. All entity management (projects, use cases, test cases) lives in the cloud via `muggle-remote-*` tools. Local execution (`muggle-local-*`) is stateless — it receives what it needs and runs the test.

### Entity model

```
Project (e.g., "My App")
  └── Use Case (e.g., "User Login Flow")
       └── Test Case (e.g., "Login with valid credentials")
            └── Test Script (recorded browser automation steps)
                 └── Run Result (pass/fail + screenshots)
```

<details>
<summary>Test execution flow</summary>

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

</details>

---

## Three Ways to Use It

### 1. `/muggle:test-feature-local` — Test a feature on localhost

Describe what to test in English. The AI finds the right project and test cases, launches a real browser, and reports results with screenshots.

```
> /muggle:test-feature-local

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

### 2. `/muggle:muggle-do` — Autonomous dev pipeline

Full development cycle: requirements to PR in one command. The AI codes the feature, writes unit tests, runs QA against your running app, and opens a PR.

```
> /muggle:muggle-do "Add a logout button to the header"

REQUIREMENTS  → Goal: Add logout button. Criteria: visible, functional, redirects.
IMPACT        → frontend repo, src/components/Header.tsx
VALIDATE      → Branch: feat/add-logout, 1 commit
CODING        → (writes/fixes code)
UNIT_TESTS    → 12/12 pass
QA            → 3/3 test cases pass
OPEN_PRS      → PR #42 opened
DONE          → 1 iteration, all green
```

- Session-based with crash recovery (`.muggle-do/sessions/`)
- Auto-triage: analyzes failures and loops back to fix (max 3 iterations)
- Multi-repo support via `muggle-repos.json`
- PRs include QA results and screenshots in the description

### 3. Direct MCP tool calls — Build your own QA workflow

Use any of the 70+ MCP tools directly from your AI assistant. This is the lowest-level option and the most flexible for building custom QA workflows.

```
"Create a project called My App with URL https://myapp.com"
"Generate test cases for the checkout flow"
"Replay all test scripts against localhost:3000"
"Show me the latest QA results"
```

---

## What MCP tools are included?

muggle-ai-works provides 70+ MCP tools organized into 8 categories: authentication, project management, use cases, test cases, test scripts, local execution, reports, and administration. These tools power all AI testing automation workflows — from one-off browser checks to full QA automation pipelines.

<details>
<summary>Authentication (muggle-remote-auth-*)</summary>

| Tool | Purpose |
|------|---------|
| `muggle-remote-auth-status` | Check authentication status |
| `muggle-remote-auth-login` | Start device-code login flow |
| `muggle-remote-auth-poll` | Poll for login completion |
| `muggle-remote-auth-logout` | Clear credentials |

</details>

<details>
<summary>Project Management (muggle-remote-project-*)</summary>

| Tool | Purpose |
|------|---------|
| `muggle-remote-project-create` | Create QA project |
| `muggle-remote-project-list` | List all projects |
| `muggle-remote-project-get` | Get project details |
| `muggle-remote-project-update` | Update project |
| `muggle-remote-project-delete` | Delete project |

</details>

<details>
<summary>Use Cases (muggle-remote-use-case-*)</summary>

| Tool | Purpose |
|------|---------|
| `muggle-remote-use-case-list` | List use cases |
| `muggle-remote-use-case-create-from-prompts` | Create from natural language |
| `muggle-remote-use-case-prompt-preview` | Preview before creating |
| `muggle-remote-use-case-update-from-prompt` | Regenerate from new prompt |

</details>

<details>
<summary>Test Cases (muggle-remote-test-case-*)</summary>

| Tool | Purpose |
|------|---------|
| `muggle-remote-test-case-list` | List all test cases |
| `muggle-remote-test-case-list-by-use-case` | List by use case |
| `muggle-remote-test-case-get` | Get test case details |
| `muggle-remote-test-case-create` | Create test case |
| `muggle-remote-test-case-generate-from-prompt` | Generate from prompt |

</details>

<details>
<summary>Test Scripts and Workflows (muggle-remote-workflow-*)</summary>

| Tool | Purpose |
|------|---------|
| `muggle-remote-test-script-list` | List test scripts |
| `muggle-remote-test-script-get` | Get script details |
| `muggle-remote-workflow-start-website-scan` | Scan site for use cases |
| `muggle-remote-workflow-start-test-case-detection` | Generate test cases |
| `muggle-remote-workflow-start-test-script-generation` | Generate scripts |
| `muggle-remote-workflow-start-test-script-replay` | Replay single script |
| `muggle-remote-workflow-start-test-script-replay-bulk` | Batch replay |

</details>

<details>
<summary>Local Execution (muggle-local-*)</summary>

| Tool | Purpose |
|------|---------|
| `muggle-local-check-status` | Check local QA engine status |
| `muggle-local-execute-test-generation` | Generate test script locally |
| `muggle-local-execute-replay` | Replay existing script locally |
| `muggle-local-cancel-execution` | Cancel active execution |
| `muggle-local-run-result-list` | List run results |
| `muggle-local-run-result-get` | Get detailed results + screenshots |
| `muggle-local-publish-test-script` | Publish script to cloud |

</details>

<details>
<summary>Reports and Analytics (muggle-remote-report-*)</summary>

| Tool | Purpose |
|------|---------|
| `muggle-remote-report-stats-summary-get` | Report statistics |
| `muggle-remote-report-cost-query` | Query cost/usage |
| `muggle-remote-report-final-generate` | Generate final report (PDF/HTML/Markdown) |
| `muggle-remote-project-test-results-summary-get` | Test results summary |

</details>

<details>
<summary>Administration (PRD, secrets, billing, scheduling)</summary>

| Category | Tools |
|----------|-------|
| PRD processing | `muggle-remote-prd-*` — upload and process product requirements docs |
| Secrets management | `muggle-remote-secret-*` — store credentials for test environments |
| Wallet and billing | `muggle-remote-wallet-*` — manage credits and payment methods |
| Scheduling | `muggle-remote-recommend-*` — get CI/CD and schedule recommendations |

</details>

---

## Works with muggle-ai-teams

[muggle-ai-teams](https://github.com/multiplex-ai/muggle-ai-teams) is the companion package for agent orchestration, workflow steps, and delivery. When both packages are installed, muggle-ai-teams automatically integrates QA into the development workflow at each stage.

| Workflow Step | What Happens |
|--------------|-------------|
| **Plan** | QA test instructions written per implementation slice |
| **Build** | Per-slice QA via muggle-ai-works before each commit |
| **Verify** | Full regression sweep replaying all project scripts |
| **Ship** | QA results published to cloud, linked in PR description |

Frontend slices get browser QA. Backend-only slices are verified by unit tests (browser QA skipped with documented reasoning).

Install both: `npm install @muggleai/works @muggleai/teams`

**Muggle AI open-source ecosystem:**

| Package | Purpose | Install |
|---------|---------|---------|
| **muggle-ai-works** (this repo) | QA testing MCP server + autonomous dev pipeline | `/plugin install muggle@<marketplace>` |
| **[muggle-ai-teams](https://github.com/multiplex-ai/muggle-ai-teams)** | Agent orchestration, workflow, skills, rules | `npm install @muggleai/teams` |

Want the full platform experience? [MuggleTest](https://www.muggletest.com) gives you everything out of the box — no setup, no configuration.

---

## CLI Reference

```bash
# Server (main command — starts MCP server for AI clients)
muggle serve              # Start with all tools (default)
muggle serve --qa         # Cloud QA tools only
muggle serve --local      # Local QA tools only

# Setup and Diagnostics
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

## Setup and Configuration

Authentication happens automatically when you first use a tool that requires it: a browser window opens with a verification code, you log in with your Muggle AI account, and the tool call continues. Credentials persist across sessions in `~/.muggle-ai/`.

<details>
<summary>MCP client configuration examples</summary>

When installed as a plugin, MCP server configuration is shipped by the plugin (`plugin/.mcp.json`) and does not require manual user-level file copy.

**Environment targeting** — set `MUGGLE_MCP_PROMPT_SERVICE_TARGET` to switch between production and dev:

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

**Multi-repo config for /muggle:muggle-do** — create `muggle-repos.json` in your working directory:

```json
[
  { "name": "frontend", "path": "/absolute/path/to/frontend", "testCommand": "pnpm test" },
  { "name": "backend", "path": "/absolute/path/to/backend", "testCommand": "pnpm test" }
]
```

</details>

<details>
<summary>Data directory structure (~/.muggle-ai/)</summary>

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

</details>

---

## What AI clients does it work with?

Full support for Claude Code. MCP tools work with Cursor and any MCP-compatible client. Plugin skills (`/muggle:muggle-do`, `/muggle:test-feature-local`) require Claude Code plugin support.

<details>
<summary>Platform compatibility table</summary>

| Platform | MCP Tools | /muggle:muggle-do | /muggle:test-feature-local |
|----------|-----------|-----------|-------------------|
| **Claude Code** | Yes | Yes | Yes |
| **Cursor** | Yes (via MCP) | No (needs plugin) | No (needs plugin) |
| **Others** | Via MCP if supported | No | No |

</details>

---

<details>
<summary>Troubleshooting</summary>

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

</details>

---

## About

Built by the team behind [MuggleTest](https://www.muggletest.com) — [AI-powered QA testing](https://www.muggletest.com) for teams who ship fast.

<details>
<summary>For contributors</summary>

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

**CI/CD**

| Workflow | Trigger | Description |
|----------|---------|-------------|
| `ci.yml` | Push/PR to `master` | Lint, test, build on multiple platforms |
| `publish-works.yml` | Tag `v*` or manual | Verify, audit, smoke-install, publish to npm |

**Publishing**

```bash
# Update version in package.json
git tag v2.0.1 && git push --tags
# publish-works.yml handles the rest
```

</details>

---

## License

[MIT](LICENSE) — Use it, fork it, make it yours.

If this helps your development workflow, consider giving it a star. It helps others find it.
