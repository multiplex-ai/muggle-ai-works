"""Planning and result regrouping for the routing eval's single-pass sweep.

Chunk identity survives the pool: every result row carries `expected_skill`, so
the per-skill view the report and the disconnect guard need is a partition of
one pooled run rather than a subprocess per skill.
"""

from pool_constants import MAX_DISCONNECT_ATTEMPTS
from regression_gate import skill_tally
from scoring import NONE


def plan_pooled_items(skills: list[str], by_skill: dict) -> list[dict]:
    """Every selected skill's queries flattened into one pool, in `skills` order."""
    return [item for skill in skills for item in by_skill.get(skill, [])]


def partition_results_by_skill(results: list[dict], skills: list[str]) -> dict[str, list[dict]]:
    """Pooled result rows regrouped under the skill each one was expected to route to.

    Output shape: `{"muggle-test": [row, ...], "none": [row, ...]}`, one key per
    entry in `skills` even when that skill contributed no rows.
    """
    grouped: dict[str, list[dict]] = {skill: [] for skill in skills}
    for result in results:
        expected = result.get("expected_skill", NONE)
        if expected in grouped:
            grouped[expected].append(result)
    return grouped


def recall_from_results(results: list[dict], skill: str) -> float:
    """Share of one skill's queries that routed correctly. No queries reads as 1.0."""
    passed, total = skill_tally(results, skill)
    return passed / total if total else 1.0


def resolve_disconnect_retries(
    grouped: dict[str, list[dict]],
    rerun_skill,
    max_attempts: int = MAX_DISCONNECT_ATTEMPTS,
    on_retry=None,
) -> tuple[dict[str, list[dict]], list[str]]:
    """Re-run every positive skill the pool returned at 0% recall, one skill at a time.

    A flat 0% is almost always a mid-sweep MCP disconnect rather than a real
    routing collapse, and a genuine description regression surfaces as partial
    recall instead. `rerun_skill(skill)` re-runs that one skill's queries in
    isolation and returns its replacement rows; `on_retry(skill, attempt, limit)`
    reports each attempt.

    Output shape: `(grouped, ["muggle-status"])` — the second element names the
    skills still at 0% after `max_attempts`, which are inconclusive, not failures.
    """
    flagged = []
    for skill in list(grouped):
        if skill == NONE:
            continue
        results = grouped[skill]
        attempts = 1
        while recall_from_results(results, skill) == 0.0 and attempts < max_attempts:
            attempts += 1
            if on_retry:
                on_retry(skill, attempts, max_attempts)
            results = rerun_skill(skill)
            grouped[skill] = results
        if recall_from_results(results, skill) == 0.0:
            flagged.append(skill)
    return grouped, flagged
