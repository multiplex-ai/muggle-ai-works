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

```bash
python plugin/skills/_routing-eval/router_eval.py \
  --eval-set plugin/skills/_routing-eval/eval-set.json \
  --repo-root "$(pwd)" \
  --runs 3 --workers 5 --timeout 180 \
  --out plugin/skills/_routing-eval/reports/<name>.json

python plugin/skills/_routing-eval/analyze.py report \
  --in plugin/skills/_routing-eval/reports/<name>.json \
  --out plugin/skills/_routing-eval/reports/<name>.md
```

## Optimization loop (per skill)

1. Run the router eval; `analyze.py report` surfaces each skill's recall and the confusion pairs.
2. For a skill with misses, `analyze.py derive --skill <X>` emits a `run_eval`-format results file (a query is a positive for X iff `expected_skill == X`; a sibling stealing X's query is a failed trigger, X firing on a sibling's query is a false trigger).
3. Feed that to skill-creator's `improve_description.py` to propose a new description, then review it for length, intent fidelity, and boundary clarity.
4. Apply to the skill's `SKILL.md`, re-run the router eval, confirm the skill improved with no new collisions.
5. One PR per skill, stacked sequentially on the previous.
