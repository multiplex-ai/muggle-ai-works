# Muggle Works for AI agents

Muggle Works (`@muggleai/works`, CLI `muggle`) is an acceptance test agent for coding agents: it drives a real browser through the user flows a change touches and puts the evidence, with screenshots, on the pull request. It ships an MCP server with 130 tools, a CLI, and a plugin of slash-command skills for Claude Code, Codex and Cursor.

## Install

| Host | Command |
| :--- | :------ |
| Any (CLI + MCP server) | `npm install -g @muggleai/works` (Node 22+) |
| Claude Code plugin | `/plugin marketplace add multiplex-ai/muggle-ai-works`, then `/plugin install muggleai@muggle-works` |
| Codex plugin | `codex plugin marketplace add multiplex-ai/muggle-ai-works`, then `codex plugin add muggle@muggle-works` |
| Cursor | `npm install -g @muggleai/works`; postinstall writes `~/.cursor/mcp.json` and syncs skills to `~/.cursor/skills/` |
| Other MCP clients | Register `muggle serve` (stdio), as below |

```json
{ "mcpServers": { "muggle": { "command": "muggle", "args": ["serve"], "env": { "MUGGLE_MCP_PROMPT_SERVICE_TARGET": "production" } } } }
```

Naming: the Claude Code marketplace entry is `muggleai`, the installed plugin is `muggle`, so skills appear as `/muggle:<skill>` (short aliases such as `/mtest` also work). Codex uses `$muggle:<skill>`.

`muggle doctor` checks the install; `muggle setup --force` re-downloads the browser runner.

## Sign-in

Local browser runs and every `muggle-remote-*` tool except `muggle-remote-pricing-get` need an account.

| Situation | CLI | MCP tools |
| :-------- | :-- | :-------- |
| Check | `muggle status` | `muggle-remote-auth-status` |
| Existing account | `muggle login [--key-expiry 90d]` (device code in the browser) | `muggle-remote-auth-login`, then `muggle-remote-auth-poll` if still pending |
| No account | `/muggle:muggle-register` | `muggle-remote-auth-register` (email + password, no browser; stores the API key) |
| Sign out | `muggle logout` | `muggle-remote-auth-logout` |

Credentials live in `~/.muggle-ai/` (`oauth-session.json`, `api-key.json`). Long-lived keys: `muggle-remote-auth-api-key-*`.

## Entity model

`Project → Use case → Test case → Test script → Run result`. The cloud stores projects, use cases, test cases and scripts (`muggle-remote-*`). The local runner executes in a real browser on this machine (`muggle-local-*`) and reaches `localhost`.

## Flows

### Local test generation and replay

For an app on `localhost` or a preview URL.

1. `muggle-remote-project-list` or `muggle-remote-project-create`.
2. `muggle-remote-use-case-create-from-prompts` (plain English) or `muggle-remote-use-case-list`.
3. `muggle-remote-test-case-generate-from-prompt` or `muggle-remote-test-case-list-by-use-case`, then `muggle-remote-test-case-get`.
4. Generate: `muggle-local-execute-test-generation` with the test case and the local URL. Put any limit the run must respect (target, path, data it may change) in the test case description; the runner does not read chat.
5. Replay: `muggle-remote-test-script-get`, `muggle-remote-action-script-get` (its `actionScriptId`), then `muggle-local-execute-replay` with the script, action script, test case description and local URL.
6. Read the outcome: `muggle-local-run-result-get` (verdict, screenshots, `viewUrl`) or `muggle-local-run-steps-get` (each step beside its frame).

`muggle-local-check-status` reports the runner; `muggle-local-cancel-execution` stops a run.

### Cloud workflows

For a publicly reachable URL, run in Muggle's cloud. Each `muggle-remote-workflow-start-*` returns immediately; poll the matching `muggle-remote-wf-get-*` or `muggle-remote-workflow-get-*` tool.

| Step | Start | Poll |
| :--- | :---- | :--- |
| Scan a site for use cases | `muggle-remote-workflow-start-website-scan` | `muggle-remote-workflow-get-website-scan-latest-run` |
| Process a requirements doc | `muggle-remote-prd-file-upload`, `muggle-remote-workflow-start-prd-file-process` | `muggle-remote-wf-get-prd-process-latest-run` |
| Detect test cases | `muggle-remote-workflow-start-test-case-detection` | `muggle-remote-wf-get-tc-detect-latest-run` |
| Generate scripts | `muggle-remote-workflow-start-test-script-generation[-bulk]` | `muggle-remote-wf-get-ts-gen-latest-run` |
| Replay scripts | `muggle-remote-workflow-start-test-script-replay[-bulk]` | `muggle-remote-wf-get-ts-replay-latest-run`, `muggle-remote-wf-get-ts-replay-bulk-latest-run` |

Cancel with `muggle-remote-workflow-cancel-run` or `-cancel-runtime`.

### Pull-request walkthroughs

A walkthrough is a PR comment with the pass/fail summary, per-step screenshots and dashboard links.

- `/muggle:muggle-pr-visual-walkthrough` posts one from finished results, rendered by `muggle build-pr-section`.
- `muggle ci-install` adds `.github/workflows/muggle-walkthrough.yml`, which runs `muggle pr-walkthrough-check --check-run` and fails while the walkthrough is missing or reports a failure.
- `/muggle:muggle-do` and `/muggle:muggle-test` post the walkthrough themselves.

## Skills

Claude Code: `/muggle:<name>` or the alias. Codex: `$muggle:<name>`. Source: `plugin/skills/<name>/SKILL.md`.

| Skill | Alias | Use when |
| :---- | :---- | :------- |
| `muggle` | `/m` | Unsure which command applies; opens the menu |
| `muggle-do` | `/mdo` | Build a feature or fix end to end and open a PR with browser proof |
| `muggle-test` | `/mtest` | Validate a diff, branch or PR before it ships; maps the change to affected flows |
| `muggle-test-feature-local` | `/mtestlocal` | Test one named flow against localhost |
| `muggle-test-prepare` | `/mtestprep` | Check and start the dev servers a run needs |
| `muggle-test-import` | `/mimport` | Import Playwright, Cypress, Gherkin, PRDs or test-plan docs as test cases |
| `muggle-test-regenerate-missing` | `/mregen` | Bulk-regenerate scripts for test cases that have none |
| `muggle-browser-task` | `/mbt` | Carry out a real action on a website (not a pass/fail test) |
| `muggle-pr-visual-walkthrough` | `/mpr` | Post existing results to a PR |
| `muggle-pr-followup` | `/mprfollowup` | Watch a PR and address new review comments, red CI and base drift |
| `muggle-feedback` | `/mfeedback` | Flag a generated script or step as wrong so it is regenerated |
| `muggle-bug-report` | `/mbugreport` | Report a bug in Muggle AI itself, then follow or answer the ticket |
| `muggle-taste-profile` | `/mtaste` | Distill the user's taste into a profile test runs use as guidance |
| `muggle-run-view` | `/mrun` | Show a local run's steps beside its frames |
| `muggle-preferences` | `/mprefs` | View, set or reset preferences |
| `muggle-init` | `/minit` | First-time onboarding |
| `muggle-ci-install` | `/mci` | Add the walkthrough check to GitHub Actions |
| `muggle-login` / `muggle-logout` | `/mlogin` / `/mlogout` | Sign in, switch accounts, sign out |
| `muggle-register` | `/mregister` | Create an account |
| `muggle-status` | `/mstatus` | Diagnose the install: MCP server, tools, sign-in |
| `muggle-repair` | `/mrepair` | Fix a broken install |
| `muggle-upgrade` | `/mupgrade` | Update to the newest version |
| `muggle-cleanup` | `/mcleanup` | Remove old runner versions and obsolete skills |

## Pricing

Never quote a price from memory. Read the live catalog: `muggle pricing [--json]` or the `muggle-remote-pricing-get` tool (no sign-in). `muggle-remote-wallet-package-list` lists the token packages the signed-in user can buy; `muggle-remote-wallet-topup` returns a checkout link for one.

## Results

| What | Where |
| :--- | :---- |
| Local run | `~/.muggle-ai/sessions/{runId}/`: `action-script.json`, `results.md`, `electron-runtime/screenshot/` |
| Local run, in the terminal | `muggle run-view [runId]` (`--html`, `--open`) |
| Dashboard link | `viewUrl` in `muggle-local-run-result-get`; `muggle-remote-local-run-upload` publishes a run that has none |
| Cloud runs | `muggle-remote-wf-get-*`, `muggle-remote-project-test-runs-summary-get`, `muggle-remote-report-final-generate` (PDF, HTML, Markdown) |
| `muggle-do` cycle state | `~/.muggle-ai/muggle-do/sessions/` |

## Common errors

| Symptom | Fix |
| :------ | :-- |
| `unauthorized_client` at login | `MUGGLE_MCP_PROMPT_SERVICE_TARGET` points at a different environment than the account; fix it and restart the MCP client |
| Remote tool reports no credentials | `muggle-remote-auth-status`, then `muggle-remote-auth-login` or `muggle login` |
| Browser runner not found | `muggle setup --force`, then `muggle doctor` |
| Run verdict `insufficient_balance` | A billing stop, not a failed test; check `muggle pricing` and top up |
| Codex cuts a local run off after 60 s | Set `tool_timeout_sec = 1800` on the `muggle` MCP server, or install the Codex plugin |
| `codex exec` refuses muggle tools | Approve them in `~/.codex/config.toml` (see README, Codex) |
| Test touched the wrong page or data | Put the limit in the test case description and regenerate |

## More

- [README](README.md): cycle, commands, MCP tool and CLI reference, configuration.
- [llms.txt](llms.txt): link index for LLMs.
- MCP resources: `muggle://docs/agents` (this file) and `muggle://docs/llms`, served by `muggle serve`.
