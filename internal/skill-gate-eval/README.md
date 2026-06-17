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
    harness.ts      # runs one scenario: spawns agent, captures trace, asserts
    mock-mcp.ts     # in-process stub for the muggle MCP namespace
    scenario.ts     # scenario file loader (types live in types.ts)
    types.ts        # shared types + PreferenceValue enum
    constants.ts    # ASK_QUESTION_TOOL, PASS_THRESHOLD, DEFAULT_MODEL
    run.ts          # CLI entrypoint
```

Scenario data lives in `muggle-ai-brain/eval/skill-gate-eval/<gate>/`,
not here. The harness reads scenarios from there and writes results
back to the same place.

## Running

Layer 2 is **ad-hoc**, never wired to CI — trigger it by hand when you
want it. From the muggle-ai-works repo root, via the `test:gates:behavioral`
script (forward args after `--`):

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

A scenario passes if it succeeds on ≥ 99% of runs (per the design doc).

## Why not vitest

Layer 1 lives in `src/test/skills/` and runs via vitest on every
commit. Layer 2 is multi-turn agent sessions — slow, costs API
tokens, nondeterministic. Keeping it out of the vitest tree avoids
running it on every unit-test commit; it runs instead as its own
blocking workflow — see CI below.

## CI (blocking)

`.github/workflows/skill-eval.yml` runs every gate found under
`$MUGGLE_BRAIN_DIR/eval/skill-gate-eval/*/scenarios.json` on each PR to
`master` (`--runs 10`, each scenario must hold ≥99%), plus nightly and on
`workflow_dispatch`. It checks out `muggle-ai-brain` for the scenarios, so
CI needs two repo secrets: `CLAUDE_CODE_OAUTH_TOKEN` (subscription auth, from
`claude setup-token`) and `BRAIN_REPO_TOKEN` (read access to the scenario repo).
