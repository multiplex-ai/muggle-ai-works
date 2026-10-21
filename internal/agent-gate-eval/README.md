# agent-gate-eval

Behavioral contract eval for the pinned execution agents in `plugin/agents/`. Layer 2 beside `src/test/agents/agent-contracts.test.ts` (Layer 1, static): each scenario dispatches the agent's definition on its **frontmatter-pinned model** and gates on the observable contract — the `READY` / `DEGRADED:` / `needs-input:` report, the render-vs-post tool trace, and the no-user-channel rule (asking the user fails the run).

## Mechanics

- System prompt = the agent's `.md` body; model = its `model:` pin resolved via `MODEL_ALIASES` (no override flag — the pin honoring the contract is what's under test).
- `Read` is real, scoped to the plugin tree, so the stage files the agent links must resolve; the rest of the repo is denied (a lockfile-sized Read overflows the run's context).
- `Bash` never executes: each call is denied with the scenario's scripted output (`bashResponses`, first `commandContains` match wins, `""` is the catch-all), keeping runs hermetic.
- Muggle MCP is mocked when a scenario declares `fixtures`: the harness mounts the in-process mock server shared with `../skill-gate-eval` (`buildMockMcpServer`), so an agent whose contract runs through the tools — `acceptance-tester` — completes a run without auth, cloud, or Electron. A `mcp__eval_mock__*` call is recorded under its bare name (`muggle-local-execute-replay`) so `requireToolAttempts` matches it; a stray production `mcp__plugin_muggle_muggle__*` call is denied with a redirect. Bash-only agents omit `fixtures` and never mount it.
- `AskUserQuestion` is denied and counted; any ask fails the verdict unless a scenario sets `forbidAskUserQuestion: false`.
- Pool/throttle plumbing is imported from `../skill-gate-eval` (shared `ThrottleGate`, bounded concurrency, `PASS_THRESHOLD`).

## Run

```bash
pnpm run test:agents:behavioral -- --agent test-prepare-runner --runs 5
pnpm run test:agents:behavioral -- --agent visual-walkthrough-builder --runs 5 --scenario mode-b --verbose
```

`--concurrency N` (or `AGENT_GATE_EVAL_CONCURRENCY`) bounds parallel reps. Results land in `scenarios/<agent>.results.json`; exit 0 iff every scenario's pass rate ≥ `PASS_THRESHOLD`.

## Under Codex

`--host codex` runs every rep in the Codex CLI (`src/codex-harness.ts`) on the same scenarios, judged by the same `verdict.ts`:

```bash
CODEX_API_KEY=... pnpm run test:agents:behavioral -- --agent test-prepare-runner --runs 5 --host codex
```

- The agent's definition and the environment note go in as Codex developer instructions, through a config profile of the rep's own. When the scenario has `fixtures`, that profile also serves the mock muggle tools as a stdio MCP server named `muggle` (shared with `../skill-gate-eval`).
- `src/codex-agent-hook.mjs`, a PreToolUse hook on every tool, records each call and decides it:
  - A shell command that only reads files in the plugin tree runs for real, in Codex's read-only sandbox. Codex reads files through the shell, so this is the agent SDK harness's plugin-scoped `Read`.
  - Every other shell call is blocked with the scenario's scripted output, marked SIMULATED OUTPUT (the agent SDK harness's Bash channel).
  - A mock muggle call runs.
  - `request_user_input` is denied and counted, since there is no user.
  - Anything else is denied.
- Codex ignores an agent's `model:` pin, so reps run Codex's default model unless `--model` names one. That flag applies under Codex only.
- `--codex-home <dir>` and `--codex-config key=value` work as in `../skill-gate-eval`. `MUGGLE_CODEX_SANDBOX` overrides the sandbox on a machine where Codex cannot start its own.

Results land in `scenarios/<agent>.codex.results.json`. The plumbing runs against the real Codex CLI and a scripted model in `src/test/codex/codex-agent-eval.test.ts` (CI's `codex-compat`), and the hook's rules are unit-tested in `test/codex-harness.test.ts`. CI: the `codex-agent-gate-eval` job in `.github/workflows/codex-skill-eval.yml`, scoped like `agent-gate-eval` plus the shared Codex plumbing. It needs the `OPENAI_API_KEY` secret, posts a notice and passes without it, and is not a required check.

## Scenarios

`scenarios/<agent>.json` — `{ agent, scenarios: [{ name, prompt, bashResponses?, fixtures?, expect }] }`. `expect` supports `outputContains` / `outputMatches` / `outputNotContains` / `outputNotMatches` (regex sources), `requireToolAttempts` / `forbidToolAttempts` (`{tool, argContains}` against the serialized input), and `forbidAskUserQuestion`. `fixtures` (shape from `../skill-gate-eval`) holds the canned muggle MCP responses for an MCP-driven agent — the dispatch `prompt` carries the run procedure the orchestrator would paste. Scenario files live in-repo (unlike skill-gate-eval's brain-hosted data) because the contract they gate is `plugin/agents/*.md` in this repo; `agent-contracts.test.ts` enforces that every execution agent has one.

CI: the `agent-gate-eval` job in `.github/workflows/skill-eval.yml` — scoped to PRs touching `plugin/agents/`, this package, or the dispatching skills; full on nightly/dispatch/`run-full-eval`.
