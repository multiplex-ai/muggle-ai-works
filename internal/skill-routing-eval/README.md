# Skill routing eval

Measures whether each muggle skill's `description` (its "entrance") routes the right user queries to it — and only those — when all 14 auto-trigger skills compete in one session.

## Files

- `entrances.md` — the trigger contract per skill: when to engage, and the sibling boundary it must not cross.
- `eval-set.json` — labeled queries `{query, expected_skill, note}`. `expected_skill` is `none` for negative/near-miss queries that must not route to any muggle skill.
- `router_eval.py` — the real-router harness.
- `analyze.py` — turns a router run into a report and into per-skill signal for the optimizer.
- `reports/` — generated reports per iteration.

## Harness

For each query it runs `claude -p "<query>" --max-turns 1` inside this repo, where the muggle plugin is active and all skills compete. It parses the streamed events for the first tool call: if Claude invokes the `Skill` tool, the chosen skill name is the route; otherwise the route is `none`. `--max-turns 1` stops execution right after the routing decision, so no skill body ever runs — there are no side effects. Every query runs N times (default 3) and the majority route is scored against `expected_skill`.

This is faithful in a way isolated single-skill triggering tests are not: it catches cross-skill collisions (two skills both plausibly match, the wrong one wins), which are the dominant failure mode for a family of sibling skills.

## Run it

One command — chunks per skill, guards against MCP disconnects, aggregates, and writes the report:

```bash
python internal/skill-routing-eval/run.py --all          # full set
python internal/skill-routing-eval/run.py --skill muggle-status   # one skill
python internal/skill-routing-eval/run.py --all --sync-cache      # see below
```

Output lands in `reports/run/` (`combined.json` + `combined.md`, plus per-skill `chunk_*.json`). `run.py` runs each skill's queries as a separate `claude -p` batch so an MCP disconnect can only spoil one chunk, not the whole sweep; a positive chunk that comes back all-`none` (the disconnect signature) is re-run once and flagged if it stays empty. Within a chunk, a run that fails with a rate-limit signature retries up to 3× with exponential backoff shared across the worker pool (`throttle.py`), and exhausted retries score as `THROTTLED` rather than a silent `none` — which is what makes `--workers` above the old default of 3 safe (CI uses 6).

**`--sync-cache`:** the harness routes via the *installed* muggle plugin, not the working tree. When you've edited a `SKILL.md` description but not reinstalled, `claude -p` sees both the cached copy and the bare-name working-tree skill and results are unreliable. `--sync-cache` copies `plugin/skills/*/SKILL.md` over the installed cache first (auto-detected from `~/.claude/plugins/installed_plugins.json`) so the eval tests your edits. Always pass it when validating a description change.

### Lower-level (single set, no chunking)

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
- `--fail-under F` — exit non-zero if accuracy < F, or if a chunk stays 0% (suspected disconnect, unverified). Default `0.0` keeps dev runs informational. CI uses `1.0` on PRs (changed skills must route perfectly) and `0.95` for the nightly full sweep.
- `router_eval.py --probe "<query>"` — route one query and print the result; CI uses it to fail fast when the plugin didn't load.

CI installs the plugin from the PR checkout (`claude plugin marketplace add "$GITHUB_WORKSPACE"`), so it tests the PR's descriptions rather than master — no `--sync-cache` needed. Requires the `CLAUDE_CODE_OAUTH_TOKEN` repo secret (subscription auth from `claude setup-token`, not a pay-per-use API key).

## Optimization loop (per skill)

1. Run the router eval; `analyze.py report` surfaces each skill's recall and the confusion pairs.
2. For a skill with misses, `analyze.py derive --skill <X>` emits a `run_eval`-format results file (a query is a positive for X iff `expected_skill == X`; a sibling stealing X's query is a failed trigger, X firing on a sibling's query is a false trigger).
3. Feed that to skill-creator's `improve_description.py` to propose a new description, then review it for length, intent fidelity, and boundary clarity.
4. Apply to the skill's `SKILL.md`, re-run the router eval, confirm the skill improved with no new collisions.
5. One PR per skill, stacked sequentially on the previous.
