# agent-gate-eval

Behavioral contract eval for the pinned execution agents in `plugin/agents/` and for skills in `plugin/skills/`. Layer 2 beside `src/test/agents/agent-contracts.test.ts` (Layer 1, static): each scenario runs its target and gates on the observable contract — the final report, the tool-attempt trace (what was called, and in what order), the files left in the run's sandbox, and the no-user-channel rule.

## Targets

Every scenario file names one `target`: `{ "kind": "agent" | "skill", "name": "<name>" }`.

- **Agent:** system prompt = the agent's `.md` body; model = its `model:` pin resolved via `MODEL_ALIASES` (the pin honoring the contract is what's under test, so `--model` never overrides it). Offered Read, Bash, AskUserQuestion.
- **Skill:** Claude Code's own system prompt plus a synthesized SessionStart block — the `Muggle Test Preferences` line, every shipped default from `plugin/config/preference-defaults.json` with the scenario's `preferences` set over them. The first user message is the invocation as a typed `/<skill> <prompt>` produces it: the command and its arguments, then `Base directory for this skill: <dir>` and the SKILL.md body, so relative stage links resolve. Model: `--model`, else the frontmatter `model:`, else `DEFAULT_SKILL_MODEL`. Offered Read, Write, Edit, Bash, AskUserQuestion, the host stubs, and the mock muggle tools.

## Mechanics

- **Sandbox.** Every run gets a temp dir with `home/` and `repo/`; the repo is the working directory. `seed.repo` copies a fixture from `fixtures/` (e.g. `tiny-web-app`) in as the repo; `seed.files` pre-populates either side (`~/…` in home, relative in repo). `~`, `$HOME`, and the real home directory are redirected into the sandbox home; the plugin tree keeps its real path. `{{home}}` and `{{repo}}` in seed file content and in scripted Bash output become the run's sandbox paths, so seeded session state can name the working tree. The sandbox is deleted after the run.
- **One tool policy** (`src/tools/policy.ts`), applied in a PreToolUse hook and again in canUseTool. The hook is the gate: canUseTool alone never sees calls the SDK allows by itself, such as read-only Bash commands and Reads inside the working directory.
  - Read is real within the plugin tree and the sandbox, so a broken stage link fails behaviorally. Write and Edit are real within the sandbox only.
  - Bash never executes: each call gets the scenario's scripted output (`bashResponses`, first `commandContains` match wins, `""` is the catch-all; an entry with `sequence` gives its nth matching call the nth entry, the last repeating).
  - AskUserQuestion is denied with a scripted answer from `toolResponses.AskUserQuestion`, else "there is no user". Any ask fails the verdict unless the scenario sets `forbidAskUserQuestion: false`.
- **Host stubs** (skill targets). The SDK runs Skill, Agent, TodoWrite, CronCreate, CronDelete and Monitor without consulting canUseTool, and Skill, Agent and CronDelete reject unknown names before any hook fires. Each is replaced by a same-named in-process stub (`mcp__eval_host__<name>`), recorded under the bare name and answered from `toolResponses` by `argContains`; nothing runs.
- **Mock muggle MCP** (`src/tools/sequenced-mock-mcp.ts`) mounts for skill targets and for agent scenarios that declare `fixtures`. It serves `../skill-gate-eval`'s mock tools plus `src/tools/supplemental-mock-tools.ts`; a fixture slot holding `{ "sequence": [...] }` answers successive calls in order, counted per slot (a failing run, then a passing one). A stray production `mcp__plugin_muggle_muggle__*` call is denied with a redirect.
  - The supplemental tools cover the cloud reads an E2E stage makes (`test-script-get`, `action-script-get`, `test-case-ancestors-get`) and the case lifecycle: `use-case-create-from-prompts`, `test-case-generate-from-prompt` and `test-case-create` answer from their input, and `test-case-delete` / `use-case-delete` acknowledge the id. Created test cases are numbered `tc-new-1`, `tc-new-2`, … and read back by `test-case-get`. Executing a case other than the `executeResult` run's own answers with that run retargeted to the case, under a run id (`<runId>-<testCaseId>`) that `run-result-get` and `run-steps-get` answer for, so every case a run plans has evidence of its own.
  - A supplemental tool named like a shared one refines it and falls through when it has no answer. The `testCasesByUseCase` slot (`{ "<useCaseId>": <list reply> }`) gives each use case its own `test-case-list-by-use-case` reply, `test-case-list` returns all of them unless `testCases` is set, and `test-case-get` finds a listed case by id; without the slot each answers as before.
- **Mid-pipeline start.** `seed.transcript` gives the turns a run has already taken — assistant text and tool calls with their results — and a `resumePrompt`; the run resumes from them instead of starting at the invocation (`src/transcript/`). `{{home}}`, `{{repo}}` and `{{pluginRoot}}` stand for the run's paths. A call without `result` is answered as a live call would be: a Read from the file, a Write or Edit applied to the sandbox (so the files the history claims exist), Bash and scripted tools from the scenario's scripts, a mock muggle call from its fixture. The session is served through the agent SDK's alpha `sessionStore`, used only in `src/transcript/resume.ts`; the SDK resumes it in a temporary config directory, which the sandbox cleanup removes, so nothing reaches `~/.claude`.
- **Trace.** Tool attempts are recorded from the model's own `tool_use` blocks, in call order, so even calls the SDK rejects at input validation count. Mock and stub calls are recorded under their bare names. A resumed run's history is not in the trace.
- **Isolation.** No filesystem settings, no MCP servers but the eval's own (`strictMcpConfig`), no transcript written to `~/.claude/projects`.
- **Spend.** Each rep's cost, wall time and turn count come from the SDK's terminal result; the runner prints them per rep and a mean per scenario, and the results file records the means.
- Pool/throttle plumbing and `PASS_THRESHOLD` come from `../skill-gate-eval`.

## Run

```bash
pnpm run test:agents:behavioral                                    # every scenario file
pnpm run test:agents:behavioral -- --suite test-prepare-runner --runs 5
pnpm run test:agents:behavioral -- --suite visual-walkthrough-builder --runs 5 --scenario mode-b --verbose
pnpm run test:agents:behavioral -- --suite muggle-do.handoff --cadence pr --model claude-opus-5-5
```

`--suite <stem>` names one file; `--agent <name>` is the same but refuses a skill target. `--cadence pr` drops `cadence: "nightly"` scenarios. `--concurrency N` (or `AGENT_GATE_EVAL_CONCURRENCY`) bounds parallel reps across all suites. Each suite's results land in `scenarios/<stem>.results.json`; exit 0 iff every scenario's pass rate meets its file's `passThreshold` (default `PASS_THRESHOLD`).

## Under Codex

`--host codex` runs every rep in the Codex CLI (`src/codex-harness.ts`) on the same scenarios, judged by the same `verdict.ts`. Agent targets only, and no scenario using `sequence`, `seed`, `toolResponses`, or `requireArtifacts`: the Codex harness keeps no sandbox and its hook answers each call alone.

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
- Codex ignores an agent's `model:` pin, so reps run Codex's default model unless `--model` names one.
- `--codex-home <dir>` and `--codex-config key=value` work as in `../skill-gate-eval`. `MUGGLE_CODEX_SANDBOX` overrides the sandbox on a machine where Codex cannot start its own.

Results land in `scenarios/<stem>.codex.results.json`. The plumbing runs against the real Codex CLI and a scripted model in `src/test/codex/codex-agent-eval.test.ts` (CI's `codex-compat`), and the hook's rules are unit-tested in `test/codex-harness.test.ts`. CI: the `codex-agent-gate-eval` job in `.github/workflows/codex-skill-eval.yml`, scoped like `agent-gate-eval` plus the shared Codex plumbing. It needs the `OPENAI_API_KEY` secret, posts a notice and passes without it, and is not a required check.

## Scenarios

`scenarios/<target>.json`, or `scenarios/<target>.<suite>.json` for a second suite on one target:

```json
{
  "target": { "kind": "skill", "name": "muggle-do" },
  "passThreshold": 1,
  "scenarios": [{
    "name": "…", "prompt": "…", "cadence": "pr", "maxTurns": 40,
    "preferences": { "autoCreatePR": "never" },
    "seed": { "repo": "tiny-web-app", "files": [{ "path": "~/.muggle-ai/muggle-do/sessions/s/state.md", "content": "…" }] },
    "bashResponses": [{ "commandContains": "pnpm lint", "sequence": ["1 error", "0 errors"] }],
    "toolResponses": { "Skill": [{ "argContains": "muggle-test-prepare", "response": "READY" }] },
    "fixtures": { "executeResult": { "sequence": [{ "status": "failed" }, { "status": "passed" }] } },
    "expect": { "requireToolSequence": [{ "tool": "Bash", "argContains": "gh pr create" }, { "pattern": "watcher-armed" }] }
  }]
}
```

`scenarios/muggle-do.handoff.json` is the full example: shared `defaults` (a transcript through Stage 5, the fixture repo, every external stubbed) and named `patterns`.

`scenarios/muggle-do.e2e-scope.json` gates muggle-do's E2E scoping: impact analysis lists a removed feature's cases as retired with `replacedBy: none` and plans new cases for uncovered criteria, Stage 6 runs only that scope and deletes nothing, and post-merge cleanup deletes the retired cases on a merged PR only. It resumes a seeded session at Stage 4 in `fixtures/greeting-site`.

`expect` supports `outputContains` / `outputMatches` / `outputNotContains` / `outputNotMatches` (regex sources), `requireToolAttempts` / `forbidToolAttempts`, `requireToolSequence` (those patterns in order, other attempts allowed between), `requireArtifacts` (`{path, contains?, matches?}`: a sandbox file, or a recorded Write or Bash attempt naming the path — Bash never runs, so `cat > prs.json` writes nothing; `matches` is a regex source, for where a value sits in the file rather than only that it appears), and `forbidAskUserQuestion`. A tool-attempt pattern is `{tool, argContains}`, matched against the serialized input — `argContains` a substring, or a list it must carry every one of — or `{anyOf: [...]}`, met by any one alternative, for an action the instructions allow more than one way.

A file may also carry `defaults`, applied to each scenario (its own `prompt`, `seed` and `maxTurns` win; `preferences` and `fixtures` merge over the default's; its `bashResponses` and `toolResponses` entries go first, so they win the first match), and `patterns`, named patterns an expectation uses as `{ "pattern": "<name>" }`. Scenario files live in-repo (unlike skill-gate-eval's brain-hosted data) because the contracts they gate are in this repo; `agent-contracts.test.ts` enforces that every execution agent has scenarios and every file targets an agent or skill that exists, and `test/transcript.test.ts` materializes every shipped transcript.

CI, in `.github/workflows/skill-eval.yml`:

- `agent-gate-eval` (required) runs the agent suites — scoped to PRs touching `plugin/agents/`, this package, or the dispatching skills; full on nightly/dispatch/`run-full-eval`. It skips skill suites.
- `muggle-do-eval` (not required yet) runs the skill suites — on PRs touching `muggle-do/`, `do/`, `muggle-pr-followup/`, `_shared/pr-followup-helpers/`, `_shared/vcs/` or this package, at `--cadence pr` with `MUGGLE_DO_EVAL_RUNS` reps (3); every scenario at 5 reps on nightly, dispatch and `run-full-eval`. A scoped-out run prints `MUGGLE_DO_RUNS_SCOPED: <runs skipped>`.
