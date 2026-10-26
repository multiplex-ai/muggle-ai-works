# Skill Gate Eval — Layer 2 (behavioral)

Behavioral test harness for skill preference gates. Spawns a real agent
session against a skill, with all Muggle MCP tools stubbed and
`AskQuestion` intercepted, then asserts the recorded tool-call trace
honors the gate contract for each preference value.

Design: `muggle-ai-brain/architecture/` — grep for "skill preference-gate eval".

## Layout

```
internal/skill-gate-eval/
  src/
    harness.ts          # runs one scenario: spawns agent, captures trace
    codex-harness.ts    # the same under the Codex CLI (--host codex)
    codex-gate-hook.mjs # Codex PreToolUse hook: records, answers, denies
    verdict.ts          # asserts a trace against the scenario — shared by both hosts
    prompt-inputs.ts    # the skill, gate contract and session context a prompt is built from
    mock-tools.ts       # the canned muggle tools, independent of the host
    mock-mcp.ts         # ...mounted in process for the agent SDK
    mock-mcp-stdio.ts   # ...served over stdio for Codex
    scenario.ts         # scenario file loader (types live in types.ts)
    types.ts            # shared types + PreferenceValue enum
    constants.ts        # ASK_QUESTION_TOOL, PASS_THRESHOLD, DEFAULT_MODEL, Codex knobs
    concurrency.ts      # bounded rep pool + shared throttle gate (vitest-covered)
    run.ts              # CLI entrypoint
    report.ts           # markdown summary of the results files
```

Scenario data lives in `muggle-ai-brain/eval/skill-gate-eval/<gate>/`,
not here. The harness reads scenarios from there and writes results
back to the same place.

## Running

Layer 2 runs in CI — blocking on every PR to `master` (see [CI](#ci-blocking)
below) — and by hand whenever you want it. From the muggle-ai-works repo root,
via the `test:gates:behavioral` script (forward args after `--`):

```bash
MUGGLE_BRAIN_DIR=../muggle-ai-brain \
  pnpm test:gates:behavioral -- \
    --gate showElectronBrowser \
    --skill muggle-test-feature-local \
    --runs 10
```

(equivalently `pnpm tsx internal/skill-gate-eval/src/run.ts …`)

**Auth:** the harness drives `@anthropic-ai/claude-agent-sdk`'s `query()`, which uses your **Claude Code login session** by default — no API key needed when you're logged in. In headless CI, authenticate with your subscription: run `claude setup-token` once and set `CLAUDE_CODE_OAUTH_TOKEN` (not a pay-per-use API key).

The harness loads
`$MUGGLE_BRAIN_DIR/eval/skill-gate-eval/showElectronBrowser/scenarios.json`,
runs each scenario `--runs` times, and writes results to
`$MUGGLE_BRAIN_DIR/eval/skill-gate-eval/showElectronBrowser/results.json`.

**Concurrency:** reps are isolated agent sessions, so they run through a
bounded pool — `--concurrency N` (or `SKILL_GATE_EVAL_CONCURRENCY`), default 4;
`--concurrency 1` restores strictly sequential runs. Rate-limited reps retry up
to 3× with exponential backoff, and the cooldown is shared across the pool so
one 429 pauses new starts for every worker instead of compounding. `--verbose`
traces interleave under concurrency; each line is prefixed with its
scenario/rep label.

A scenario passes if it succeeds on ≥ 80% of runs — `PASS_THRESHOLD` in
`src/constants.ts`, which is the only authority. These runs are probabilistic:
a healthy gate still misses occasionally, so a bar set at perfection flakes
every run and teaches everyone to ignore the job.

## Under Codex

`--host codex` runs every rep in the Codex CLI instead of the agent SDK, on the same scenarios and fixtures, judged by the same `verdict.ts`:

```bash
CODEX_API_KEY=... MUGGLE_BRAIN_DIR=../muggle-ai-brain \
  pnpm test:gates:behavioral -- \
    --gate showElectronBrowser --skill muggle-test-feature-local --runs 10 --host codex
```

- **Prompt.** The same skill, gate contract and synthesized SessionStart context, given to Codex as developer instructions. The Codex notes replace the agent SDK notes. Where the skill says AskUserQuestion, Codex is told what the skills' `_shared/host-tool-equivalents.md` table tells a real Codex session. The prompt is built from the same inputs only, and `test/system-prompt.test.ts` holds both hosts to that.
- **Tools.** The shell and Codex's other built-in tools are switched off. The mock muggle tools are served over stdio as a required `muggle` MCP server, so Codex names them exactly as it names the real ones. `codex-gate-hook.mjs`, a PreToolUse hook on every tool, records each call. A mock muggle call runs, `request_user_input` is answered with the scenario's scripted pick (the same deny channel the agent SDK harness answers AskUserQuestion on), and anything else is denied.
- **Questions in prose.** Where Codex does not offer its question tool, a skill asks by ending its turn on the question. A turn that ends on a question the scenario scripts is answered by resuming the thread with the pick, up to `CODEX_MAX_RESUMES` times.
- **Model.** Codex ignores a skill's `model:`, so the reps run Codex's default model unless `--model` names one.
- **Codex home.** Each gate run gets a fresh Codex home, authenticated by `CODEX_API_KEY`. `--codex-home <dir>` reuses one instead, for example a directory you ran `CODEX_HOME=<dir> codex login` in. The eval writes its own `config.toml` and `hooks.json` there, and refuses a directory whose `config.toml` it did not write. `--codex-config key=value` (repeatable) passes a config override to every run.

Results go to `results.codex.json`, beside the agent SDK's `results.json`. `report.ts <brain-dir> --host codex` summarizes them. The plumbing (prompt, tools, both answer channels, denials, verdict) runs against the real Codex CLI and a scripted model in `src/test/codex/codex-gate-eval.test.ts`, part of CI's `codex-compat` job. The hook's own rules are unit-tested in `test/codex-harness.test.ts`.

## Why not vitest

Layer 1 lives in `src/test/skills/` and runs via vitest on every
commit. Layer 2 is multi-turn agent sessions — slow, costs API
tokens, nondeterministic. Keeping it out of the vitest tree avoids
running it on every unit-test commit; it runs instead as its own
blocking workflow — see CI below.

## CI (blocking)

`.github/workflows/skill-eval.yml` runs every gate found under
`$MUGGLE_BRAIN_DIR/eval/skill-gate-eval/*/scenarios.json` on each PR to
`master` (`--runs 10` at `--concurrency 4`, each scenario must hold ≥80%),
plus nightly and on `workflow_dispatch`. Gates run one at a time — the
parallelism lives inside each gate's rep pool — so per-gate log groups stay
attributable. What a PR owes is decided by `scripts/skill-eval-scope.sh`: the
harness or a preference gate contract forces the full suite, a `model:`-only
`SKILL.md` edit scopes to that skill, and everything else — runtime, docs, a
support file under a skill directory — is skipped. A support file is skipped
because it provably cannot reach a gate prompt, which is built from `SKILL.md`
plus the gate contract while the harness denies the `Read` tool; `test/system-prompt.test.ts`
pins that, and if it ever fails the scope rule has to widen with it. Label a PR
`run-full-eval` to force the whole suite anyway — the lever for de-risking a
refactor that changes how skills run, not their definitions.
It checks out `muggle-ai-brain` for the scenarios, so
CI needs two repo secrets: `CLAUDE_CODE_OAUTH_TOKEN` (subscription auth, from
`claude setup-token`) and `BRAIN_REPO_TOKEN` (read access to the scenario repo).

`CLAUDE_CODE_OAUTH_TOKEN_2`, `_3` and `_4` are optional secrets holding
**spare subscription tokens**, ideally from other accounts, since a weekly
usage limit applies to a whole account — `BRAIN_REPO_TOKEN` is repo-read auth
and unrelated. Every eval job probes the tokens in order before it starts work
and runs on the first that authenticates, so a rejected or throttled token no
longer red-lines the suite. A fallback raises a workflow warning rather than
passing silently, and it tells the two apart: a token that hit its weekly or
session limit is named with its reset time and comes back on its own, while a
rejected token needs regenerating with `claude setup-token`. Leave the spares
unset to run single-token.

### Codex (not blocking)

`.github/workflows/codex-skill-eval.yml` runs every gate under Codex nightly, on demand, and on PRs whose change Codex's runs can see. That is the `full` decision of `scripts/skill-eval-scope.sh`, or a change to `_shared/host-tool-equivalents.md`. A `model:`-only change is skipped, since Codex ignores `model:`. The job needs the `OPENAI_API_KEY` repo secret, handed to Codex as `CODEX_API_KEY`, as well as `BRAIN_REPO_TOKEN`. Without them it posts a notice and passes. It is not a required check, and each scenario must hold the same 80%.
