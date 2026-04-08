# *muggle-ai-works*

**Run real-browser E2E acceptance tests on your web app from any AI coding agent. Generate test scripts from plain English, replay them on localhost, capture screenshots, and validate user flows like signup, checkout, and dashboards. Works across Claude Code, Cursor, Codex, and Windsurf.**

One install gives your AI coding assistant the power to exercise your app like a real user would: clicking through flows, catching broken experiences, and reporting results with screenshots and evidence.

*[License: MIT](LICENSE)
[npm]()
[MCP Tools]()
[Node*]()

*Powered by [MuggleTest](https://www.muggletest.com) — the [AI-powered E2E acceptance testing platform](https://www.muggletest.com).*

---

## Why muggle-ai-works?

Your AI assistant writes code fast. But does the feature actually work? Does the login flow break on mobile? Does the checkout still render after that refactor?

muggle-ai-works closes the gap between "code complete" and "actually works."

- **Catch UX regressions before your users do** — AI drives a real browser against your localhost across desktop and mobile resolutions, clicks through flows like a user would, and reports failures with step-by-step screenshots. No Playwright scripts to maintain.
- **Go from requirement to merged PR in one command** — `/muggle:muggle-do` handles the full cycle: code the feature, run unit tests, run E2E acceptance tests against the app in a real browser at multiple viewports, triage failures, and open a PR with evidence attached.
- **70+ MCP tools for custom workflows** — manage projects, generate test cases from plain English, replay test scripts, batch-run regressions, and publish results to your team. Works in Claude Code, Cursor, and any MCP client.

---

## Quick Start

### 1. Install (choose your client)

**Claude Code (full plugin experience)**

```
/plugin marketplace add https://github.com/multiplex-ai/muggle-ai-works
/plugin install muggleai@muggle-works
```

This installs:

- `/muggle:muggle` — command router and menu
- `/muggle:muggle-do` — autonomous dev pipeline (requirements to PR)
- `/muggle:muggle-test` — change-driven E2E acceptance testing (local or remote, with PR posting)
- `/muggle:muggle-test-feature-local` — local quick E2E acceptance testing
- `/muggle:muggle-test-regenerate-missing` — bulk-regenerate test scripts for every test case that has no active script
- `/muggle:muggle-status` — health check for muggle-works plugins (Electron app, MCP server, and auth)
- `/muggle:muggle-repair` — diagnose and fix broken installation
- `/muggle:muggle-upgrade` — update to the latest version
- MCP server with 70+ tools (auto-started)
- Electron browser test runner provisioning (via session hook)

**Cursor, Codex, Windsurf, and other MCP clients (MCP tools only)**

```bash
npm install -g @muggleai/works
```

Then configure your MCP client:

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

`npm install` also syncs `muggle-*` skills to `~/.cursor/skills/` for Cursor discovery. Claude slash commands are plugin-managed, so update those with `/plugin update muggleai@muggle-works`.

### 2. Verify

**Claude Code**

```
/muggle:muggle-status
```

This checks Electron browser test runner, MCP server health, and authentication. If anything is broken, run `/muggle:muggle-repair`.

**Cursor/Codex/Windsurf/other MCP clients**

Run any `muggle-*` MCP tool from your client after adding the MCP server config above. Authentication starts automatically on first protected tool call.

### 3. Start building features

**Claude Code**

Describe what you want to build:

```
/muggle:muggle-do "Add a logout button to the header"
```

The AI handles the full cycle: code the feature, run unit tests, run E2E acceptance tests against the app in a real browser, and open a PR with results.

**Cursor/Codex/Windsurf/other MCP clients**

Use the direct MCP workflow section below to call `muggle-*` tools from your client.

### 4. Test a feature locally

**Claude Code**

Already have code running on localhost? Test it directly:

```
/muggle:muggle-test-feature-local
```

Describe what to test in plain English. The AI finds or creates test cases, launches a real browser, and reports results with screenshots.

**Cursor/Codex/Windsurf/other MCP clients**

Call local execution MCP tools directly (for example `muggle-local-execute-test-script-replay` or related `muggle-local-*` commands exposed by your client).

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

Test execution flow

```
Your AI assistant describes what to test
         │
         v
muggle-remote-* tools create test cases in cloud
         │
         v
muggle-local-execute-test-generation launches the browser test runner
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
muggle-local-publish-test-script uploads to cloud → returns viewUrl to open dashboard
```

---

## Three Ways to Use It

### 1. `/muggle:muggle-test-feature-local` — Test a feature on localhost

Describe what to test in English. The AI finds the right project and test cases, launches a real browser, and reports results with screenshots.

```
> /muggle:muggle-test-feature-local

"Test my login changes on localhost:3999"

1. Auth check ✓
2. Found project: "My App"
3. Found use case: "User Login"
4. Found 2 test cases — recommend replay (minor changes detected)
5. Launching browser test runner... (approve? y)
6. Results: 2/2 PASS
   Screenshots: ~/.muggle-ai/sessions/abc123/screenshots/
7. Publish to cloud? (y)
```

### 2. `/muggle:muggle-do` — Autonomous dev pipeline

Full development cycle: requirements to PR in one command. The AI codes the feature, writes unit tests, runs E2E acceptance tests against your running app, and opens a PR.

```
> /muggle:muggle-do "Add a logout button to the header"

REQUIREMENTS  → Goal: Add logout button. Criteria: visible, functional, redirects.
IMPACT        → frontend repo, src/components/Header.tsx
VALIDATE      → Branch: feat/add-logout, 1 commit
CODING        → (writes/fixes code)
UNIT_TESTS    → 12/12 pass
E2E acceptance → 3/3 test cases pass
OPEN_PRS      → PR #42 opened
DONE          → 1 iteration, all green
```

- Session-based with crash recovery (`.muggle-do/sessions/`)
- Auto-triage: analyzes failures and loops back to fix (max 3 iterations)
- Multi-repo support via `muggle-repos.json`
- PRs include E2E acceptance results and screenshots in the description

### 3. Direct MCP tool calls — Build your own E2E acceptance workflow

Use any of the 70+ MCP tools directly from your AI assistant. This is the lowest-level option and the most flexible for building custom E2E acceptance workflows.

```
"Create a project called My App with URL https://myapp.com"
"Generate test cases for the checkout flow"
"Replay all test scripts against localhost:3000"
"Show me the latest E2E acceptance results"
```

---

## What MCP tools are included?

muggle-ai-works provides 70+ MCP tools organized into 8 categories: authentication, project management, use cases, test cases, test scripts, local execution, reports, and administration. These tools power all AI testing automation workflows — from one-off browser checks to full E2E acceptance automation pipelines.

Authentication (muggle-remote-auth-*)


| Tool                        | Purpose                      |
| --------------------------- | ---------------------------- |
| `muggle-remote-auth-status` | Check authentication status  |
| `muggle-remote-auth-login`  | Start device-code login flow |
| `muggle-remote-auth-poll`   | Poll for login completion    |
| `muggle-remote-auth-logout` | Clear credentials            |


Project Management (muggle-remote-project-*)


| Tool                           | Purpose             |
| ------------------------------ | ------------------- |
| `muggle-remote-project-create` | Create E2E acceptance test project   |
| `muggle-remote-project-list`   | List all projects   |
| `muggle-remote-project-get`    | Get project details |
| `muggle-remote-project-update` | Update project      |
| `muggle-remote-project-delete` | Delete project      |


Use Cases (muggle-remote-use-case-*)


| Tool                                           | Purpose                                                  |
| ---------------------------------------------- | -------------------------------------------------------- |
| `muggle-remote-use-case-list`                  | List use cases                                           |
| `muggle-remote-use-case-create`                | Persist a fully-specified use case (no LLM)              |
| `muggle-remote-use-case-create-from-prompts`   | Create from natural language                             |
| `muggle-remote-use-case-prompt-preview`        | Preview before creating                                  |
| `muggle-remote-use-case-update-from-prompt`    | Regenerate from new prompt                               |
| `muggle-remote-use-case-bulk-preview-submit`   | Async batch-preview via OpenAI Batch API (~50% cheaper)  |


Test Cases (muggle-remote-test-case-*)


| Tool                                           | Purpose                                                  |
| ---------------------------------------------- | -------------------------------------------------------- |
| `muggle-remote-test-case-list`                 | List all test cases                                      |
| `muggle-remote-test-case-list-by-use-case`     | List by use case                                         |
| `muggle-remote-test-case-get`                  | Get test case details                                    |
| `muggle-remote-test-case-create`               | Create test case                                         |
| `muggle-remote-test-case-generate-from-prompt` | Generate from prompt                                     |
| `muggle-remote-test-case-bulk-preview-submit`  | Async batch-preview via OpenAI Batch API (~50% cheaper)  |


Bulk Preview Jobs (muggle-remote-bulk-preview-job-*)

Manage async jobs started by the `*-bulk-preview-submit` tools above. Submit returns a
`jobId` immediately; poll `-get` until a terminal status, then persist the results via
`muggle-remote-use-case-create` / `muggle-remote-test-case-create`.

| Tool                                    | Purpose                                 |
| --------------------------------------- | --------------------------------------- |
| `muggle-remote-bulk-preview-job-get`    | Poll a bulk-preview job for status/results |
| `muggle-remote-bulk-preview-job-list`   | List bulk-preview jobs for a project    |
| `muggle-remote-bulk-preview-job-cancel` | Cooperatively cancel an in-flight job   |


Test Scripts and Workflows (muggle-remote-workflow-*)


| Tool                                                   | Purpose                 |
| ------------------------------------------------------ | ----------------------- |
| `muggle-remote-test-script-list`                       | List test scripts       |
| `muggle-remote-test-script-get`                        | Get script details      |
| `muggle-remote-workflow-start-website-scan`            | Scan site for use cases |
| `muggle-remote-workflow-start-test-case-detection`     | Generate test cases     |
| `muggle-remote-workflow-start-test-script-generation`  | Generate scripts        |
| `muggle-remote-workflow-start-test-script-replay`      | Replay single script    |
| `muggle-remote-workflow-start-test-script-replay-bulk` | Batch replay            |


Local Execution (muggle-local-*)


| Tool                                   | Purpose                            |
| -------------------------------------- | ---------------------------------- |
| `muggle-local-check-status`            | Check local browser test runner status       |
| `muggle-local-execute-test-generation` | Generate test script locally       |
| `muggle-local-execute-replay`          | Replay existing script locally     |
| `muggle-local-cancel-execution`        | Cancel active execution            |
| `muggle-local-run-result-list`         | List run results                   |
| `muggle-local-run-result-get`          | Get detailed results + screenshots |
| `muggle-local-publish-test-script`     | Publish script to cloud, returns `viewUrl` |


Reports and Analytics (muggle-remote-report-*)


| Tool                                             | Purpose                                   |
| ------------------------------------------------ | ----------------------------------------- |
| `muggle-remote-report-stats-summary-get`         | Report statistics                         |
| `muggle-remote-report-cost-query`                | Query cost/usage                          |
| `muggle-remote-report-final-generate`            | Generate final report (PDF/HTML/Markdown) |
| `muggle-remote-project-test-results-summary-get` | Test results summary                      |


Administration (PRD, secrets, billing, scheduling)


| Category           | Tools                                                                |
| ------------------ | -------------------------------------------------------------------- |
| PRD processing     | `muggle-remote-prd-`* — upload and process product requirements docs |
| Secrets management | `muggle-remote-secret-`* — store credentials for test environments   |
| Wallet and billing | `muggle-remote-wallet-`* — manage credits and payment methods        |
| Scheduling         | `muggle-remote-recommend-*` — get CI/CD and schedule recommendations |


---

## Works with muggle-ai-teams

[muggle-ai-teams](https://github.com/multiplex-ai/muggle-ai-teams) is the companion package for agent orchestration, workflow steps, and delivery. When both packages are installed, muggle-ai-teams automatically integrates E2E acceptance testing into the development workflow at each stage.


| Workflow Step | What Happens                                            |
| ------------- | ------------------------------------------------------- |
| **Plan**      | E2E acceptance test instructions written per implementation slice   |
| **Build**     | Per-slice E2E acceptance tests via muggle-ai-works before each commit     |
| **Verify**    | Full regression sweep replaying all project scripts     |
| **Ship**      | E2E results published to cloud, linked in PR description |


Frontend slices get browser E2E tests. Backend-only slices are verified by unit tests (browser E2E skipped with documented reasoning).

Install both: `npm install @muggleai/works @muggleai/teams`

**Muggle AI open-source ecosystem:**


| Package                                                                | Purpose                                         | Install                                 |
| ---------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------- |
| **muggle-ai-works** (this repo)                                        | E2E acceptance testing MCP server + autonomous dev pipeline | `/plugin install muggleai@muggle-works` |
| **[muggle-ai-teams](https://github.com/multiplex-ai/muggle-ai-teams)** | Agent orchestration, workflow, skills, rules    | `npm install @muggleai/teams`           |


Want the full platform experience? [MuggleTest](https://www.muggletest.com) gives you everything out of the box — no setup, no configuration.

---

## CLI Reference

```bash
# Server (main command — starts MCP server for AI clients)
muggle serve              # Start with all tools (default)
muggle serve --e2e        # Cloud E2E tools only (muggle-remote-*)
muggle serve --local      # Local E2E tools only (muggle-local-*)

# Setup and Diagnostics
muggle setup              # Download/update browser test runner
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

MCP client configuration examples

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

Data directory structure (~/.muggle-ai/)

```
~/.muggle-ai/
├── oauth-session.json    # OAuth tokens (short-lived, auto-refresh)
├── api-key.json          # Long-lived API key for service calls
├── projects/             # Local project cache
├── sessions/             # E2E test sessions
│   └── {runId}/
│       ├── action-script.json    # Recorded browser steps
│       ├── results.md            # Step-by-step report
│       └── screenshots/          # Per-step images
└── electron-app/         # Downloaded browser test runner
    └── {version}/
```

---

## What AI clients does it work with?

Full support for Claude Code. Cursor, Codex, Windsurf, and other MCP-compatible clients use the same MCP tools but do not support Claude plugin slash commands (`/muggle:*`).

Platform compatibility table


| Platform        | MCP Tools            | Plugin skills (/muggle:*)                             |
| --------------- | -------------------- | ----------------------------------------------------- |
| **Claude Code** | Yes                  | Yes (do, test-feature-local, status, repair, upgrade) |
| **Cursor**      | Yes (via MCP)        | No (needs plugin support)                             |
| **Others**      | Via MCP if supported | No                                                    |


---

Troubleshooting

### "unauthorized_client" during login

**Cause**: MCP configured for one environment but authenticating against another.

**Fix**: Set the correct `MUGGLE_MCP_PROMPT_SERVICE_TARGET` in your MCP config and restart your client.

### Browser test runner not found

```bash
muggle setup --force    # Re-download
muggle doctor           # Diagnose
```

### Authentication keeps expiring

```bash
muggle logout           # Clear all credentials
rm ~/.muggle-ai/oauth-session.json ~/.muggle-ai/api-key.json
muggle login            # Fresh login
```

---

## About

Built by the team behind [MuggleTest](https://www.muggletest.com) — [AI-powered E2E acceptance testing](https://www.muggletest.com) for teams who ship fast.

Repository structure

```
muggle-ai-works/
├── plugin/                  # Claude Code plugin (source of truth)
│   ├── .claude-plugin/      #   Plugin manifest (plugin.json)
│   ├── skills/              #   Skill definitions
│   │   ├── muggle/                        # /muggle:muggle — command router and menu
│   │   ├── muggle-do/                     # /muggle:muggle-do — autonomous dev pipeline
│   │   ├── muggle-test-feature-local/     # /muggle:muggle-test-feature-local
│   │   ├── muggle-test-regenerate-missing/# /muggle:muggle-test-regenerate-missing
│   │   ├── muggle-status/                 # /muggle:muggle-status
│   │   ├── muggle-repair/                 # /muggle:muggle-repair
│   │   └── muggle-upgrade/                # /muggle:muggle-upgrade
│   ├── hooks/               #   Session hooks (hooks.json)
│   ├── scripts/             #   Hook scripts (ensure-electron-app.sh)
│   ├── .mcp.json            #   MCP server config
│   └── README.md            #   Plugin install and usage docs
│
├── src/                     # Application source
│   ├── cli/                 #   CLI commands (serve, setup, doctor, login, etc.)
│   └── server/              #   MCP server (tool registration, stdio transport)
│
├── packages/                # Workspace packages
│   ├── mcps/                #   Core MCP runtime — tool registries, schemas, services
│   ├── commands/            #   CLI command contracts and registration
│   └── workflows/           #   Workflow contracts and tests
│
├── scripts/                 # Build and release
│   ├── build-plugin.mjs     #   Assembles dist/plugin/ from plugin/ source
│   ├── verify-plugin-marketplace.mjs  # Validates plugin/marketplace consistency
│   ├── verify-compatibility-contracts.mjs # Validates long-term surface contracts
│   ├── verify-upgrade-experience.mjs  # Validates in-place upgrade behavior
│   └── postinstall.mjs      #   npm postinstall (Electron app download)
│
├── config/compatibility/     # Contract baselines (CLI/MCP/plugin/skills)
├── bin/                     # CLI entrypoint (muggle.js → dist/cli.js)
├── dist/                    # Build output (gitignored)
├── .claude-plugin/          # Marketplace catalog (marketplace.json)
└── docs/                    # Internal design docs and plans
```

Development commands

```bash
pnpm install              # Install dependencies
pnpm run build            # Build (tsup + plugin artifact)
pnpm run build:plugin     # Rebuild plugin artifact only
pnpm run verify:plugin    # Validate plugin/marketplace metadata consistency
pnpm run verify:contracts # Validate compatibility contracts (CLI/MCP/plugin/skills)
pnpm run verify:electron-release-checksums # Ensure checksums.txt exists for bundled electron release
pnpm run verify:upgrade-experience # Validate existing-user cleanup + re-download flow
pnpm run dev              # Dev mode (watch)
pnpm test                 # Run tests
pnpm run lint             # Lint (auto-fix)
pnpm run lint:check       # Lint (check only)
pnpm run typecheck        # TypeScript type check
```

CI/CD and publishing


| Workflow            | Trigger             | Description                                                  |
| ------------------- | ------------------- | ------------------------------------------------------------ |
| `ci.yml`            | Push/PR to `master` | Lint, test, build, plugin + compatibility contract verification on multiple platforms |
| `verify-end-user-upgrade.yml` | Weekly + manual | Existing-user upgrade validation (cleanup + re-download + health checks) |
| `publish-works-to-npm.yml` | Tag `v*` or manual  | Verify (including release checksums), audit, smoke-install, publish to npm |


```bash
git tag v<version> && git push --tags
# publish-works-to-npm.yml handles the rest
```


Release tag strategy

- `electron-app-vX.Y.Z` tags in `muggle-ai-works` are for public Electron app binary releases (consumed by `muggle setup`, `muggle upgrade`, and npm postinstall).
- `vX.Y.Z` tags in `muggle-ai-works` are for npm publishing of `@muggleai/works` (`publish-works-to-npm.yml`).
- `muggle-ai-teaching-service` builds Electron artifacts and publishes them into this public repo using `electron-app-vX.Y.Z`, so binaries are publicly downloadable.
- The two version tracks are intentionally separate: runtime Electron artifact versions and npm package versions can move independently.


Optimizing agent-facing descriptions


AI agents decide which tools to use based on text in MCP server instructions, hook context injection, skill descriptions, tool descriptions, and plugin metadata. If these don't match what users actually say, agents won't reach for muggle tools.

The `/muggle:optimize-descriptions` skill documents the full optimization process:

```
/muggle:optimize-descriptions
```

This is an **internal-only skill** (not published to customers). It covers:

- The five layers of agent-facing text and where each lives in the codebase
- How to write descriptions that match real user intent ("test my signup flow" not "execute test generation")
- How to create trigger eval sets and run them with `run_eval.py`
- Limitations of the eval tool (can't measure MCP instructions or hook injection)
- A checklist for the full optimization workflow

**Key files touched during optimization:**

| What | File |
| :--- | :--- |
| MCP server instructions | `src/server/mcp-server.ts` |
| SessionStart hook injection | `plugin/scripts/ensure-electron-app.sh` |
| Hook config | `plugin/hooks/hooks.json` |
| Skill descriptions | `plugin/skills/*/SKILL.md` |
| Tool descriptions (local) | `packages/mcps/src/mcp/tools/local/tool-registry.ts` |
| Tool descriptions (cloud) | `packages/mcps/src/mcp/tools/e2e/tool-registry.ts` |
| Plugin metadata | `plugin/.claude-plugin/plugin.json` |

**Quick eval run:**

```bash
# Requires Python 3.10+ and skill-creator plugin
cd ~/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/skill-creator

python3 -m scripts.run_eval \
  --eval-set /path/to/eval_set.json \
  --skill-path /path/to/plugin/skills/test-feature-local \
  --model claude-opus-4-6 \
  --runs-per-query 3 \
  --verbose
```

See `plugin/skills/optimize-descriptions/SKILL.md` for the full guide.

---

## License

[MIT](LICENSE) — Use it, fork it, make it yours.

If this helps your development workflow, consider giving it a star. It helps others find it.