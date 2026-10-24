"""Planning and result regrouping for the routing eval's single-pass sweep.

Chunk identity survives the pool: every result row carries `expected_skill`, so
the per-skill view the report and the disconnect guard need is a partition of
one pooled run rather than a subprocess per skill.
"""

from pool_constants import ARM_FIELD, CLAUDE_CONFIG_DIR_FIELD, MAX_DISCONNECT_ATTEMPTS
from pool_types import SweepArm
from regression_gate import skill_tally
from scoring import NONE


def plan_pooled_items(skills: list[str], by_skill: dict) -> list[dict]:
    """Every selected skill's queries flattened into one pool, in `skills` order."""
    return [item for skill in skills for item in by_skill.get(skill, [])]


def pair_with_control(items: list[dict], control_config_dir: str) -> list[dict]:
    """Each query twice, candidate then control, so the two arms of a query run side by side.

    Whatever makes the model route worse for a stretch of time moves every session
    inside it. Adjacent arms share that stretch, so it cancels in their difference.

    Output shape: `[{..., "arm": "candidate"}, {..., "arm": "control", "claude_config_dir": "/x"}]`
    """
    paired = []
    for item in items:
        paired.append({**item, ARM_FIELD: SweepArm.CANDIDATE.value})
        paired.append({**item, ARM_FIELD: SweepArm.CONTROL.value, CLAUDE_CONFIG_DIR_FIELD: control_config_dir})
    return paired


def rows_of_arm(results: list[dict], arm: SweepArm) -> list[dict]:
    """The result rows a paired sweep measured under `arm`, in plan order."""
    return [row for row in results if row.get(ARM_FIELD) == arm.value]


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
