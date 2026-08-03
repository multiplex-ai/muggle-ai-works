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

## Scenarios

`scenarios/<agent>.json` — `{ agent, scenarios: [{ name, prompt, bashResponses?, fixtures?, expect }] }`. `expect` supports `outputContains` / `outputMatches` / `outputNotContains` / `outputNotMatches` (regex sources), `requireToolAttempts` / `forbidToolAttempts` (`{tool, argContains}` against the serialized input), and `forbidAskUserQuestion`. `fixtures` (shape from `../skill-gate-eval`) holds the canned muggle MCP responses for an MCP-driven agent — the dispatch `prompt` carries the run procedure the orchestrator would paste. Scenario files live in-repo (unlike skill-gate-eval's brain-hosted data) because the contract they gate is `plugin/agents/*.md` in this repo; `agent-contracts.test.ts` enforces that every execution agent has one.

CI: the `agent-gate-eval` job in `.github/workflows/skill-eval.yml` — scoped to PRs touching `plugin/agents/`, this package, or the dispatching skills; full on nightly/dispatch/`run-full-eval`.
