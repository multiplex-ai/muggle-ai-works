# Skill routing eval

Measures whether each muggle skill's `description` (its "entrance") routes the right user queries to it — and only those — when all 14 auto-trigger skills compete in one session.

## Files

- `entrances.md` — the trigger contract per skill: when to engage, and the sibling boundary it must not cross.
- `eval-set.json` — labeled queries `{query, expected_skill, note}`. `expected_skill` is `none` for negative/near-miss queries that must not route to any muggle skill.
- `router_eval.py` — the real-router harness.
- `analyze.py` — turns a router run into a report and into per-skill signal for the optimizer.
- `recall-baseline.json` — per-skill recall recorded from a full sweep on master; what the CI gate compares a run against. Under Codex, `recall-baseline.codex.json` once one is promoted.
- `codex_session.py` — the Codex sessions (`--host codex`): runs one, ends it at its route, and prepares the Codex home they run in (`codex_constants.py`, `codex_route_tracer.mjs`).
- `seed_eval_cwd.sh` — the small changed web app both hosts' CI jobs route in.
- `regression_gate.py` — the gate: judges a run against that baseline inside a noise band (`gate_types.py`, `gate_constants.py`).
- `reports/` — generated reports per iteration.

## Harness

For each query it runs `claude -p "<query>"` inside this repo, where the muggle plugin is active and all skills compete, capped at `SESSION_MAX_TURNS` turns. It scans the whole session and takes the first route it reaches — a `Skill` invocation, or a `Read` of a skill's `SKILL.md` — because a realistic query makes the model orient (`git status`, `ls`) before it routes, and scoring only the first tool call reports a healthy session as `none`. A route naming one of the thin alias skills (`mfeedback`, `mupgrade`, …) resolves to the canonical skill it delegates to. Failing that, a muggle MCP call or a muggle `ToolSearch` counts as a coarse `muggle-*` signal; otherwise the route is `none`. Every query runs N times (default 3) and the majority route is scored against `expected_skill`.

A run that reached no skill also records *why*: `no_tool_call` (answered or declined outright), `oriented_only` (every tool call was provably read-only — `git status`, a `Grep`, a `ToolSearch` that found nothing), or `acted_without_routing` (at least one call was *not* provably read-only: an unrecognized command verb, a real output redirect, or a writing tool). The third is named for the rule rather than the behaviour on purpose — a session using read-only commands the vocabulary does not know lands there without having changed anything, so widen `INSPECTION_COMMANDS` rather than reading it as proof the model did the work itself. The reason rides on the live progress line (`route=none (oriented_only)`), and counted across a query's runs lands in the report's `none_reasons` field and the report's "Genuine misses" section. It is diagnostic only — the scored route stays the literal `none`, so the negative class and the gate see exactly what they saw before.

The turn cap is what bounds side effects, and it is a budget rather than a guarantee: one turn is spent routing, so a skill body can begin on the turn that follows. Runs are cheap to keep contained — point `--repo-root` at a throwaway directory, as CI does.

This is faithful in a way isolated single-skill triggering tests are not: it catches cross-skill collisions (two skills both plausibly match, the wrong one wins), which are the dominant failure mode for a family of sibling skills.

### Under Codex

`--host codex` (on `run.py` and `router_eval.py`) runs each query as `codex exec` instead, against the plugin installed in `$CODEX_HOME`. Codex has no skill tool and no `--max-turns`: its model opens a skill by reading the `SKILL.md` its catalog lists, and its `--json` stream leaves out calls made from inside Codex's code mode. So a PreToolUse hook the eval installs in that Codex home, `codex_route_tracer.mjs`, appends every tool call to a trace file. The runner reads the trace while the session is live and ends it at the first `SKILL.md` it reads, or after `SESSION_MAX_TOOL_CALLS` calls without one — about what Claude's two turns of orienting spend. The route, the alias resolution, the MCP fallback and the none-reasons are then scored exactly as above. Sessions run with Codex's `read-only` sandbox, the closest match to a headless Claude session that may look but not act. Set `MUGGLE_CODEX_SANDBOX` to override it on a machine where that sandbox cannot start. Hook trust is bypassed, because a headless run cannot answer Codex's trust prompt.

```bash
export CODEX_HOME=/tmp/muggle-codex-eval
python internal/skill-routing-eval/codex_session.py prepare   # plugin from this checkout + the tracer
codex login                                                    # or export CODEX_API_KEY
python internal/skill-routing-eval/run.py --all --host codex
```

Re-running `prepare` (or passing `--sync-cache`, which does the same) reinstalls the plugin from the working tree, so a description edit is what Codex sees. Output lands in `reports/run-codex/`, apart from the Claude report.

The plumbing — `prepare`, the tracer, the session's end at its route and at its cap — runs against the real Codex CLI and a scripted model in `src/test/codex/codex-routing-eval.test.ts`, part of CI's `codex-compat` job. The model-driven sweep needs a real model, so it lives in its own workflow (below).

## Run it

One command — one pooled sweep, guards against MCP disconnects, aggregates, and writes the report:

```bash
python internal/skill-routing-eval/run.py --all          # full set
python internal/skill-routing-eval/run.py --skill muggle-status   # one skill
python internal/skill-routing-eval/run.py --all --sync-cache      # see below
```

Output lands in `reports/run/` (`combined.json` + `combined.md`, plus `chunk_pooled.json` and a per-skill `chunk_*.json` for any skill the guard re-ran). `run.py` plans every selected skill's queries into **one** `claude -p` batch `--workers` wide, so no worker idles while a skill's tail drains — the sequential per-skill batches this replaced left the pool draining once per skill. Skill identity is carried on each result row, so grouping and the guard are a partition of the pooled run. A positive skill that comes back all-`none` (the disconnect signature) is re-run alone in a fresh subprocess up to 3× and flagged inconclusive if it stays empty; isolating the retry is what makes a pooled sweep as recoverable as per-skill batches were. A run that fails with a rate-limit signature retries up to 3× with exponential backoff shared across the worker pool (`throttle.py`), and exhausted retries score as `THROTTLED` rather than a silent `none` — which is what makes the default of 12 workers safe. Pooling also makes that backoff genuinely global: a separate subprocess per skill previously gave each chunk its own gate.

**`--sync-cache`:** the harness routes via the *installed* muggle plugin, not the working tree. When you've edited a `SKILL.md` description but not reinstalled, `claude -p` sees both the cached copy and the bare-name working-tree skill and results are unreliable. `--sync-cache` copies `plugin/skills/*/SKILL.md` over the installed cache first (auto-detected from `~/.claude/plugins/installed_plugins.json`) so the eval tests your edits. Always pass it when validating a description change.

### Lower-level (single set, no guard)

```bash
python internal/skill-routing-eval/router_eval.py --eval-set <set.json> --repo-root "$(pwd)" --runs 3 --workers 5 --timeout 180 --out <report.json>
python internal/skill-routing-eval/analyze.py report --in <report.json> --out <report.md>
```

## CI (blocking)

`.github/workflows/skill-eval.yml` runs this on every PR to `master`, scoped to
the skills the PR changed; the full set runs nightly and on `workflow_dispatch`.
A PR that changed no skill description is skipped; label it `run-full-eval` to
force the full 391-query sweep anyway (the lever for de-risking a runtime
refactor that touches no `SKILL.md`).

- `--skills a,b` — run a subset (CI derives it from the PR's changed `plugin/skills/*/SKILL.md`).
- `--gate` — compare the run against `recall-baseline.json`; exit non-zero on a regression, a collapse, or a sweep where no chunk could be verified. Off by default, so dev runs stay informational. CI passes it in both modes.
- `--baseline PATH` — the recorded baseline to compare against (default: `recall-baseline.json` beside the runner).
- `--record-baseline PATH` — write this run's per-skill tallies for a human to promote. Full sweeps only; a scoped run would drop every skill it did not measure.
- `--control-config-dir DIR` — a Claude config dir with the base ref's plugin installed. A failing gate re-measures its failing skills against it before it fails (see [Confirmation](#confirmation)). CI passes it on scoped runs.
- `router_eval.py --probe "<query>"` — route one query and print the result; CI uses it to fail fast when the plugin didn't load.

CI installs the plugin from the PR checkout (`claude plugin marketplace add "$GITHUB_WORKSPACE"`), so it tests the PR's descriptions rather than master — no `--sync-cache` needed. Requires the `CLAUDE_CODE_OAUTH_TOKEN` repo secret (subscription auth from `claude setup-token`, not a pay-per-use API key). Set the optional `CLAUDE_CODE_OAUTH_TOKEN_2` secret to a spare token and the job falls back to it for that run when the primary is rejected or throttled, with a workflow warning.

### Codex (not blocking)

`.github/workflows/codex-skill-eval.yml` runs the same eval with `--host codex`, on the same schedule and the same PR scoping. It also runs a full sweep when a PR changes what only Codex reads: its plugin manifest and marketplace, its hooks and MCP config, or a skill's `agents/openai.yaml`. It needs the `OPENAI_API_KEY` repo secret, which it hands Codex as `CODEX_API_KEY`. Without that secret the job posts a notice and passes. It is not a required check. Until `recall-baseline.codex.json` is committed, a run reports recall without gating it, and only the preflight can fail it. Each full sweep uploads its tallies as the `codex-routing-recall-baseline` artifact. Promote one the same way as below, and the job gates against it from then on.

## Regression gate

Routing is stochastic and master is not perfect: the nightly sweep scored 337/391 = 86.2% when this gate was written, per-skill recall spans roughly 30% to 100%, and re-measuring one unchanged description landed its chunk on 19, 20, 20 and 22 of 26 queries across four consecutive CI runs. An absolute pass bar is therefore either unreachable or meaningless, so CI gates on movement instead.

`recall-baseline.json` holds each skill's `{passed, total}` from a full sweep on master. A gated run judges every skill it measured against its entry and fails on:

- **regression** — recall below `baseline - tolerance`;
- **collapse** — recall below 10% whatever the baseline says, the backstop for a skill with no recorded entry and for a baseline recorded already degraded.

A skill absent from the baseline is reported `unbaselined` and cannot fail on regression; a chunk the disconnect guard flagged is reported `inconclusive` and is not gated at all. The pooled recall of the comparable skills is judged the same way, so several small dips that each stay inside their own band still fail the suite together.

### Tolerance

`tolerance = 2 * sqrt(2) * sqrt(p(1-p)/n)` — `p` is the baseline recall (Laplace-smoothed, so a 24/24 baseline keeps a non-zero band), `n` the query count, and the `sqrt(2)` is there because baseline and run are each one noisy measurement, so their difference carries both variances.

Three independent estimates agree on the width at `n = 26`, `p ~ 0.85`:

| estimate | queries |
|---|---|
| binomial 2-sigma of the difference | 5.0 |
| 2-sigma of the five measured muggle-test scores (23, 20, 22, 20, 19 of 26) | 4.7 |
| observed spread of those same five runs | 4.0 |

So muggle-test tolerates a drop to 18/26 against its 23/26 baseline and fails at 17/26, while a near-perfect baseline stays tight on its own terms: 24/24 may fall to 22/24, and the 48/48 negative class to 46/48.

A scoped PR run also votes over 5 runs per query rather than the sweep's 3. One chunk is cheap — 26 queries at 6 workers measured 3.1 min at 3 runs, so about 5 min at 5 — and a majority over 5 flips on fewer queries, which is the noise the gate then has to tolerate.

### Confirmation

The band above models sampling noise inside one sweep. It does not model the stretches of time in which the model routes worse across the board. With muggle-test's name and description unchanged from master, three consecutive scoped runs scored 16/26, 16/26 and 26/26; the second and third tested byte-identical plugin and harness trees twenty minutes apart, and their single runs passed 84/130 and 126/130. Ten steady measurements of that skill over the five days before had passed 85% to 94% of their runs, so a fall to 65% is no binomial wobble. Every kind of miss grew at once: against the 26/26 run, `oriented_only` went from 4 runs to 19, `acted_without_routing` from 0 to 18 and `no_tool_call` from 0 to 9. Majority voting cannot absorb it, because a query's five runs share the stretch.

So a scoped run's failing verdict is confirmed before it fails. Its failing skills run again, each query once under the PR's plugin and once under the base ref's (`--control-config-dir`), side by side, so both arms share whatever stretch they land in. The candidate arm fails only if its single-run recall sits below the control arm's by more than `2 * sqrt(sum over queries of 2r * p(1-p))`, divided by the run count. Here `p` is that query's pass rate pooled across both arms, Laplace-smoothed, and `r` is its runs per arm. A control arm that routes nothing leaves the failure standing (`unconfirmed`). Full sweeps get no confirmation, because they gate the harness itself.

Simulated for muggle-test from the per-query pass rates CI measured, at 5 runs per query. A drop of k queries means the k most reliably routed queries stop routing.

| | false failure | catches a 4-query drop | 5-query | 6-query |
|---|---|---|---|---|
| steady stretch, recorded baseline only | 0.0% | 58% | 100% | 100% |
| steady stretch, with confirmation | 0.0% | 57% | 99.9% | 100% |
| depressed stretch, recorded baseline only | 99.7% | 100% | 100% | 100% |
| depressed stretch, with confirmation | 1.8% | 82% | 95% | 99% |

A confirmation sweep costs about twice a first sweep, and it only runs when the first one fails.

### Baseline refresh

The full sweep writes `reports/run/recall-baseline.candidate.json`, and CI uploads it as the `routing-recall-baseline` artifact. Nothing commits it; a human promotes it:

1. `gh run download <run-id> -n routing-recall-baseline` from a full sweep that finished cleanly.
2. Copy it over `internal/skill-routing-eval/recall-baseline.json` and read the diff — a skill that moved should have a reason.
3. Commit it on its own.

Locally the same thing is `python internal/skill-routing-eval/run.py --all --record-baseline internal/skill-routing-eval/recall-baseline.json`.

Re-record after anything that shifts measured accuracy across the board (a harness change to what the router sees, a model change), not after each description edit — that is exactly the movement the gate exists to catch.

## Optimization loop (per skill)

1. Run the router eval; `analyze.py report` surfaces each skill's recall and the confusion pairs.
2. For a skill with misses, `analyze.py derive --skill <X>` emits a `run_eval`-format results file (a query is a positive for X iff `expected_skill == X`; a sibling stealing X's query is a failed trigger, X firing on a sibling's query is a false trigger).
3. Feed that to skill-creator's `improve_description.py` to propose a new description, then review it for length, intent fidelity, and boundary clarity.
4. Apply to the skill's `SKILL.md`, re-run the router eval, confirm the skill improved with no new collisions.
5. One PR per skill, stacked sequentially on the previous.
