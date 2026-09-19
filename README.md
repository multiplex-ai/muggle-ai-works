# Muggle Works

**An open-source harness that drives your AI coding agent through the whole delivery cycle — design, build, test, acceptance — and closes the loop on GitHub and GitLab.**

Coding agents are good at producing a diff. They are bad at knowing whether the diff works, whether it broke the login flow, and what still has to happen before a human can merge it. Muggle Works is the harness around the agent that answers those questions: it freezes requirements, delegates the design and build, runs the unit suite, drives a **real browser** through the affected user flows, opens the pull request with screenshots attached, and then keeps watching that PR — picking up review comments, red CI, and a stale base branch until the change is genuinely mergeable.

[![npm](https://img.shields.io/npm/v/@muggleai/works.svg)](https://www.npmjs.com/package/@muggleai/works)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://www.npmjs.com/package/@muggleai/works)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![MCP tools](https://img.shields.io/badge/MCP%20tools-100%2B-blue.svg)](#mcp-tool-reference)

Works in Claude Code, Cursor, Codex, Windsurf, and any MCP client. Powered by [Muggle Test](https://www.muggletest.com).

---

## Highlights

- **One request, one pull request.** `/mdo "add a logout button"` runs requirements → design → build → impact analysis → unit tests → browser acceptance → PR. You answer one questionnaire up front, then walk away.
- **A real browser under a real identity.** Not a headless stub. Every managed login profile owns a live inbox, so magic links, emailed OTPs, email 2FA, verification mail, and password resets are all testable — no mail catcher, no test-only backdoor, no `SKIP_AUTH` flag.
- **GitHub and GitLab as peers.** Pull requests and merge requests, review threads and discussions, Actions and pipelines, signed commits on both. Self-hosted GitLab included — the provider is detected from the remote, not hardcoded.
- **The loop keeps running after you close the laptop.** A watcher polls the PR and re-enters the cycle when a reviewer comments, CI goes red, or the branch falls behind its base. Feedback becomes commits without you relaying it.
- **A gate, not a vibe.** No PR is opened until requirements are written, the build typechecks and lints, new logic carries unit tests, the suite passes, and a browser verdict is recorded — or a waiver reason is written down. Silence is not a waiver.
- **Plain English in, replayable scripts out.** Describe a flow in a sentence; get a script that persists across sessions and re-runs as a regression test after every change.
- **100+ MCP tools** if you'd rather assemble your own pipeline than use the packaged one.

### Built for two kinds of people

**If you write code for a living,** this is the discipline you'd apply yourself if you had the patience to apply it every time: frozen requirements, a Definition of Done that blocks the PR, evidence attached to the review, and a follow-up loop that doesn't forget.

**If you vibe-code,** this is the part you can't easily judge by reading the diff. You don't have to know Playwright, or what a fixture is, or why the checkout page broke on mobile. Describe the feature; the harness builds it, clicks through it like a user, shows you the screenshots, and tells you what failed in English.

---

## The cycle

| # | Stage | What it does | Evidence it leaves |
| :- | :---- | :----------- | :----------------- |
| 1 | Pre-flight | Detects repo, branch, dev server, project, credentials; asks everything it can't detect in **one** turn | `state.md` |
| 2 | Requirements | Freezes goal and acceptance criteria before a line is written | `requirements.md` |
| 3 | Build | Delegates real design surface to a design → plan → subagent build, then commits (signed) | Conventional commits |
| 4 | Impact analysis | Maps the diff to the user flows it can break | Affected-flow list |
| 5 | Unit tests | Runs the suite authored in stage 3 | Exit code |
| 6 | Acceptance | Drives a real browser through the affected flows | Verdict + `runId` + per-step screenshots |
| 7 | Pull request | Opens the PR/MR with the evidence block in the body | PR URL |
| 7.5 | Repair | Investigates and fixes acceptance failures, up to 3 iterations | Repair log |
| 8 | Watcher | Polls reviews, CI, and base-branch drift; re-enters the cycle on each | `followup.log` |

Stage 7 refuses to run until the Definition of Done holds. Stage 8 is dispatched only once stage 7.5 clears — a cycle with unrepaired failures never reaches a watcher.

---

## Quick start

### 1. Install

**Claude Code** — full plugin: skills, MCP tools, and the browser runner.

```
/plugin marketplace add https://github.com/multiplex-ai/muggle-ai-works
/plugin install muggleai@muggle-works
```

**Cursor** — `npm install -g @muggleai/works`. The postinstall writes `~/.cursor/mcp.json` and syncs the `muggle-*` skills into `~/.cursor/skills/`. Restart Cursor.

**Codex, Windsurf, any other MCP client** — install the package as above, then register the server:

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

### 2. Set up

```bash
muggle init
```

Explains how the harness works, saves your preferences, and offers to install the pull-request walkthrough check. Then confirm the install is healthy:

```
/mstatus          # Claude Code
muggle doctor     # anywhere else
```

Broken? `/mrepair`, or `muggle setup --force`.

### 3. Build something

```
/mdo "Add a logout button to the header"
```

```
PRE-FLIGHT    → repo: frontend · branch: users/me/logout-button · target: localhost:3000
REQUIREMENTS  → Goal: logout button in header. AC: visible, ends session, redirects to /login.
BUILD         → src/components/Header.tsx, src/hooks/useLogout.ts (+ unit tests)
IMPACT        → affects "User Login" and "Session" flows
UNIT TESTS    → 12/12 pass
ACCEPTANCE    → 3/3 test cases pass · runId a1b2c3 · 14 screenshots
PULL REQUEST  → #42 opened, walkthrough posted
WATCHER       → armed on #42
```

Authentication starts on the first protected call: a browser opens with a verification code, you sign in, and the call continues. Credentials persist in `~/.muggle-ai/`.

---

## Commands

Every skill has a short alias. Both spellings work in Claude Code.

| Command | Alias | What it does |
| :------ | :---- | :----------- |
| `/muggle:muggle` | `/m` | Command router and menu |
| `/muggle:muggle-do` | `/mdo` | The full cycle: request → pull request |
| `/muggle:muggle-test` | `/mtest` | Change-driven acceptance testing on your diff, PR, or branch |
| `/muggle:muggle-test-feature-local` | `/mtestlocal` | Test one named flow against localhost |
| `/muggle:muggle-test-prepare` | `/mtestprep` | Verify and start the dev servers a run needs |
| `/muggle:muggle-test-import` | `/mimport` | Import Playwright, Cypress, Gherkin, or PRDs |
| `/muggle:muggle-test-regenerate-missing` | `/mregen` | Bulk-regenerate scripts for cases that have none |
| `/muggle:muggle-browser-task` | `/mbt` | Perform a real action on a website from plain English |
| `/muggle:muggle-pr-visual-walkthrough` | `/mpr` | Post screenshots and a pass/fail summary to a PR |
| `/muggle:muggle-pr-followup` | `/mprfollowup` | Watch a PR's reviews, CI, and base drift |
| `/muggle:muggle-feedback` | `/mfeedback` | Flag a generated script or step as wrong |
| `/muggle:muggle-preferences` | `/mprefs` | View, set, or reset preferences |
| `/muggle:muggle-status` | `/mstatus` | Health check: runner, MCP server, auth |
| `/muggle:muggle-repair` | `/mrepair` | Diagnose and fix a broken install |
| `/muggle:muggle-upgrade` | `/mupgrade` | Update to the latest version |

---

## GitHub and GitLab

The harness resolves one provider token — `github` or `gitlab` — from the URL you passed or the `origin` remote, then picks the matching recipe set. GitHub goes through `gh`, GitLab through `glab`. Self-hosted GitLab resolves by matching the remote host against `glab`'s configured host, so `git.acme.com` works without configuration.

| Capability | GitHub | GitLab |
| :--------- | :----- | :----- |
| Open and update the change | Pull request | Merge request |
| Read review feedback | Review threads + line comments | Discussions + notes |
| Reply per comment, resolve threads | Yes | Yes |
| Read CI status and re-enter on red | Actions | Pipelines |
| Rebase onto a drifted base | Yes | Yes |
| Signed commits | Yes | Yes |

Nested GitLab namespaces of any depth are handled — the project path is everything before the `/-/` segment, never assumed to be two levels.

### The pull-request walkthrough check

When a PR is opened from a session running this plugin, Muggle reserves a comment for the acceptance walkthrough and holds the turn open until it's settled — by the walkthrough, or by a stated reason acceptance testing doesn't apply.

A PR opened any other way — the web UI, a teammate without the plugin — never passes through that session, so the same check also runs in GitHub Actions. `muggle init` offers to install it; to add it to another repository later:

```bash
muggle ci-install
```

That writes `.github/workflows/muggle-walkthrough.yml`. To add it by hand instead:

<!-- muggle:ci-workflow-snippet -->
```yaml
name: muggle-walkthrough

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  issue_comment:
    types: [created, edited]

permissions:
  contents: read
  checks: write
  pull-requests: write

concurrency:
  group: muggle-walkthrough-${{ github.event.pull_request.number || github.event.issue.number }}
  cancel-in-progress: true

jobs:
  walkthrough-comment:
    if: github.event_name == 'pull_request' || github.event.issue.pull_request
    runs-on: ubuntu-latest
    steps:
      - name: Check the walkthrough comment
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npx -y -p @muggleai/works muggle pr-walkthrough-check --check-run
```
<!-- /muggle:ci-workflow-snippet -->

Three things worth knowing:

- The verdict is published as a check run against the pull request's head commit, not as this job's own status. An `issue_comment` run executes against the default branch, and only a head-commit check reaches the pull request from there — which is what lets settling the comment turn the check green without a new push.
- GitHub reads the `issue_comment` trigger from the **default branch's** copy of the workflow, so comment-driven re-runs start working only once it is merged.
- On a pull request from a fork, `GITHUB_TOKEN` is read-only and the check run cannot be published. The command fails open and reports nothing rather than blocking the pull request.

---

## Architecture

Test management lives in the cloud; execution is local and stateless. `muggle-remote-*` tools own projects, use cases, test cases, and scripts. `muggle-local-*` tools receive what they need and run the browser — so a local run never waits on cloud replay capacity.

### Entity model

```
Project ("My App")
  └── Use Case ("User Login Flow")
       └── Test Case ("Login with valid credentials")
            └── Test Script (recorded browser steps)
                 └── Run Result (pass/fail + screenshots)
```

### Execution flow

```
Your agent describes what to test
         │
         ▼
muggle-remote-*  create or find the test cases
         │
         ▼
muggle-local-execute-test-generation  launches the browser runner
         │
         ▼
An agent drives the browser step by step (click, type, navigate, assert)
         │
         ▼
Per-step screenshots → action-script.json recorded
         │
         ▼
Results at ~/.muggle-ai/sessions/{runId}/ — published during the run,
so the result carries a viewUrl straight to the dashboard
```

### Data directory

```
~/.muggle-ai/
├── oauth-session.json    # OAuth tokens (short-lived, auto-refresh)
├── api-key.json          # Long-lived key for service calls
├── projects/             # Local project cache
├── sessions/             # Run sessions
│   └── {runId}/
│       ├── action-script.json    # Recorded browser steps
│       ├── results.md            # Step-by-step report
│       └── screenshots/          # Per-step images
├── muggle-do/sessions/   # Cycle state, iterations, PR watchers
└── electron-app/{version}/
```

---

## MCP tool reference

106 tools across authentication, projects, use cases, test cases, scripts, workflows, local execution, reporting, secrets, billing, and administration. Call them directly from any MCP client to build your own pipeline.

**Authentication** — `muggle-remote-auth-status`, `-login`, `-poll`, `-logout`, plus `-api-key-create`, `-list`, `-get`, `-revoke`.

**Projects** — `muggle-remote-project-create`, `-list`, `-get`, `-update`, `-delete`, plus per-project rollups: `-test-results-summary-get`, `-test-runs-summary-get`, `-test-scripts-summary-get`.

| Use cases | Purpose |
| :-------- | :------ |
| `muggle-remote-use-case-list` / `-get` | Read use cases |
| `muggle-remote-use-case-create` | Persist a fully-specified use case (no LLM) |
| `muggle-remote-use-case-create-from-prompts` | Create from natural language |
| `muggle-remote-use-case-prompt-preview` | Preview before creating |
| `muggle-remote-use-case-update-from-prompt` | Regenerate from a new prompt |
| `muggle-remote-use-case-candidates-approve` | Approve discovered candidates |
| `muggle-remote-use-case-bulk-preview-submit` | Async batch preview (~50% cheaper) |
| `muggle-remote-use-case-delete` | Delete (cascades to test cases + scripts) |

| Test cases | Purpose |
| :--------- | :------ |
| `muggle-remote-test-case-list` / `-list-by-use-case` / `-get` | Read test cases |
| `muggle-remote-test-case-create` / `-update` / `-delete` | Manage test cases |
| `muggle-remote-test-case-generate-from-prompt` | Generate from a prompt |
| `muggle-remote-test-case-ancestors-get` | Walk prerequisite chains |
| `muggle-remote-test-case-bulk-preview-submit` | Async batch preview (~50% cheaper) |
| `muggle-remote-test-plan-graph-rebuild` | Rebuild the prerequisite graph |

Bulk-preview submissions return a `jobId` immediately. Poll `muggle-remote-bulk-preview-job-get` until terminal, then persist with the matching `-create` tool. `-list` and `-cancel` round out the set.

| Scripts and workflows | Purpose |
| :-------------------- | :------ |
| `muggle-remote-test-script-list` / `-get` / `-delete` | Manage test scripts |
| `muggle-remote-action-script-get` / `-delete` | Manage recorded action scripts |
| `muggle-remote-workflow-start-website-scan` | Scan a site for use cases |
| `muggle-remote-workflow-start-test-case-detection` | Generate test cases |
| `muggle-remote-workflow-start-test-script-generation` | Generate a script |
| `muggle-remote-workflow-start-test-script-generation-bulk` | Generate in bulk |
| `muggle-remote-workflow-start-test-script-replay` | Replay one script |
| `muggle-remote-workflow-start-test-script-replay-bulk` | Batch replay |
| `muggle-remote-workflow-cancel-run` / `-cancel-runtime` | Cancel in flight |
| `muggle-remote-wf-get-*` | Poll the latest run of each workflow type |

| Local execution | Purpose |
| :-------------- | :------ |
| `muggle-local-check-status` | Browser runner status |
| `muggle-local-execute-test-generation` | Generate a script by driving the browser |
| `muggle-local-execute-replay` | Replay an existing script |
| `muggle-local-cancel-execution` | Cancel the active run |
| `muggle-local-run-result-list` / `-get` | Results, screenshots, and cloud refs (`viewUrl`) |
| `muggle-local-test-script-list` / `-get` | Read locally cached scripts |
| `muggle-local-last-host-*` / `-last-project-*` | Remember the host and project between runs |
| `muggle-local-preferences-set` | Set harness preferences |
| `muggle-remote-local-run-upload` | Publish a local run to the cloud |

**Reporting** — `muggle-remote-report-stats-summary-get`, `-cost-query`, `-final-generate` (PDF/HTML/Markdown), `-preferences-upsert`.

**Administration** — `muggle-remote-prd-file-*` (upload and process requirements docs), `muggle-remote-secret-*` (credentials for test environments), `muggle-remote-wallet-*` (credits, payment methods, auto-topup), `muggle-remote-recommend-cicd-setup` / `-recommend-schedule`, `muggle-remote-user-feedback-*`.

---

## CLI reference

```bash
# Server
muggle serve                  # Start the MCP server with all tools
muggle serve --e2e            # Cloud tools only (muggle-remote-*)
muggle serve --local          # Local tools only (muggle-local-*)

# Setup and diagnostics
muggle init                   # Guided setup; saves preferences, offers the CI check
muggle setup [--force]        # Download or update the browser runner
muggle upgrade [--check]      # Install the latest runner version
muggle versions               # List installed runner versions
muggle cleanup [--dry-run]    # Remove old versions and obsolete skills
muggle doctor                 # Diagnose installation problems

# Authentication
muggle login [--key-expiry 90d]
muggle logout
muggle status

# Pull requests
muggle ci-install [--force]   # Add the walkthrough check to GitHub Actions
muggle pr-walkthrough-check   # Verify a PR's walkthrough comment is settled
muggle build-pr-section       # Render a PR evidence block from a report on stdin

muggle --version
muggle --help
```

---

## Configuration

**Environment targeting.** Set `MUGGLE_MCP_PROMPT_SERVICE_TARGET` (`production` or `dev`) in the MCP server's `env` block. Mismatching it against the account you log in with is the usual cause of `unauthorized_client`.

**Multi-repo cycles.** Drop a `muggle-repos.json` in your working directory so a single request can span services:

```json
[
  { "name": "frontend", "path": "/absolute/path/to/frontend", "testCommand": "pnpm test" },
  { "name": "backend",  "path": "/absolute/path/to/backend",  "testCommand": "pnpm test" }
]
```

**Preferences.** `/mprefs` (or `muggle init`) controls the gates — whether to use a worktree, rebase onto the base branch, run acceptance tests every cycle, open the PR automatically, and arm the watcher. Each gate takes `always`, `ask`, or `never`.

When installed as a Claude Code plugin, MCP configuration ships with the plugin (`plugin/.mcp.json`) — there is nothing to copy by hand.

---

## Client support

| Client | MCP tools | Slash commands |
| :----- | :-------- | :------------- |
| **Claude Code** | Yes | Yes — full plugin |
| **Cursor** | Yes, auto-configured | Skills synced to `~/.cursor/skills/` |
| **Codex, Windsurf, others** | Yes, via MCP config | No |

Slash commands are plugin-managed; update them with `/plugin update muggleai@muggle-works`.

---

## Troubleshooting

**`unauthorized_client` during login** — the MCP server is pointed at one environment and you're authenticating against another. Fix `MUGGLE_MCP_PROMPT_SERVICE_TARGET` and restart the client.

**Browser runner not found**

```bash
muggle setup --force
muggle doctor
```

**Authentication keeps expiring**

```bash
muggle logout
rm ~/.muggle-ai/oauth-session.json ~/.muggle-ai/api-key.json
muggle login
```

---

## The ecosystem

| Package | Purpose | Install |
| :------ | :------ | :------ |
| **Muggle Works** (this repo) | Delivery-cycle harness, MCP server, acceptance testing | `/plugin install muggleai@muggle-works` |
| **[muggle-ai-teams](https://github.com/multiplex-ai/muggle-ai-teams)** | Agent orchestration, workflow steps, rules | `npm install @muggleai/teams` |

With both installed, muggle-ai-teams folds acceptance testing into each workflow step: test instructions written per slice at **Plan**, per-slice browser tests at **Build**, a full regression sweep at **Verify**, and results published and linked in the PR at **Ship**. Frontend slices get browser tests; backend-only slices are covered by unit tests, with the skip reasoned in writing.

Want it hosted, with nothing to configure? [Muggle Test](https://www.muggletest.com).

---

## Contributing

```bash
pnpm install              # This repo is pnpm-only
pnpm run build            # tsup + plugin artifact
pnpm test                 # Test suite
pnpm run lint             # Lint (auto-fix)
pnpm run typecheck        # Type check
pnpm run dev              # Watch mode
```

Verification gates, all run in CI:

```bash
pnpm run verify:plugin     # Plugin and marketplace metadata agree
pnpm run verify:contracts  # CLI/MCP/plugin/skill surface contracts hold
pnpm run verify:skill-deps # Skill dependencies stay one-way
pnpm run verify:signatures # Shipped artifacts are signed
pnpm run verify:upgrade-experience        # Existing-user upgrade still works
pnpm run verify:electron-release-checksums
```

### Repository layout

```
muggle-ai-works/
├── plugin/               # Claude Code plugin — source of truth
│   ├── skills/           #   Skill definitions (muggle-do, muggle-test, _shared/vcs, …)
│   ├── hooks/            #   Session hooks
│   └── .mcp.json         #   MCP server config
├── src/
│   ├── cli/              # CLI entrypoint
│   └── server/           # MCP server — tool registration, stdio transport
├── packages/
│   ├── mcps/             # Tool registries, schemas, services
│   ├── commands/         # CLI command contracts
│   └── workflows/        # Workflow contracts
├── scripts/              # Build, verification, postinstall
├── config/compatibility/ # Surface contract baselines
├── internal/             # Maintainer-only skills (not published)
└── .claude-plugin/       # Marketplace catalog
```

### Releases

| Workflow | Trigger | What it does |
| :------- | :------ | :----------- |
| `ci.yml` | Push/PR to `master` | Lint, test, build, contract verification across platforms |
| `verify-end-user-upgrade.yml` | Weekly + manual | Existing-user upgrade validation |
| `publish-works-to-npm.yml` | Tag `v*` or manual | Verify, audit, smoke-install, publish |

Two independent tag tracks: `vX.Y.Z` publishes `@muggleai/works` to npm; `electron-app-vX.Y.Z` publishes browser-runner binaries consumed by `muggle setup` and `muggle upgrade`.

Maintainers cut releases with the repo-local `/mrelease` skill rather than tagging by hand — CI can otherwise publish a version that disagrees with the checked-in manifests.

Agents pick tools by reading descriptions, so that text is tuned deliberately rather than written once. `internal/skills/optimize-descriptions/SKILL.md` documents the five layers of agent-facing text, where each lives, and how to build and run trigger eval sets against them. It is maintainer-only and ships in neither the npm package nor the plugin.

---

## License

MIT. Use it, fork it, make it yours.

If it saves you a bad merge, a star helps others find it.
